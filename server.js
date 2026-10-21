import { readFile } from "node:fs/promises";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { config } from "./src/config.js";
import * as db from "./src/db.js";
import { readSubmission, sanitizeForm, toCsv } from "./src/forms.js";
import { normalizeInstance, safeNext } from "./src/util.js";
import * as views from "./src/views.js";
import { XitterError, clientMetadataDocument, finishSignIn, startSignIn } from "./src/xitter.js";

const SESSION_COOKIE = "xp_session";
const STATE_COOKIE = "xp_state";
const BODY_LIMIT = 512 * 1024;

const SECURITY_HEADERS = {
	"content-security-policy": "default-src 'self'; img-src * data:; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
	"x-content-type-options": "nosniff",
	"referrer-policy": "same-origin",
};

class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

function cookies(req) {
	const out = {};
	for (const part of (req.headers.cookie ?? "").split(";")) {
		const i = part.indexOf("=");
		if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
	}
	return out;
}

const cookie = (name, value, maxAge) =>
	`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secureCookies ? "; Secure" : ""}`;

function send(res, status, body, headers = {}) {
	res.writeHead(status, { ...SECURITY_HEADERS, "cache-control": "no-store", ...headers });
	res.end(body);
}
const html = (res, body, status = 200, headers = {}) => send(res, status, body, { "content-type": "text/html; charset=utf-8", ...headers });
const json = (res, body, status = 200) => send(res, status, JSON.stringify(body), { "content-type": "application/json" });
const redirect = (res, location, headers = {}) => send(res, 303, "", { location, ...headers });
const show = (res, { status, html: body }) => html(res, body, status);

async function body(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > BODY_LIMIT) throw new HttpError(413, "That's more than a form can hold.");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

async function formBody(req) {
	if (!(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) throw new HttpError(415, "Unsupported form encoding.");
	return new URLSearchParams(await body(req));
}

// Writes must come from our own pages: same origin, and for signed-in people
// the session's CSRF token as well
function checkOrigin(req) {
	const origin = req.headers.origin;
	if (origin && origin !== config.publicOrigin) throw new HttpError(403, "That request didn't come from this site.");
}
function checkCsrf(user, token) {
	if (!user || !token || token !== user.csrf) throw new HttpError(403, "Your session changed. Go back, reload the page and try again.");
}

const STATIC = { "style.css": "text/css", "builder.js": "text/javascript", "confirm.js": "text/javascript", "icon.svg": "image/svg+xml" };
const staticDir = fileURLToPath(new URL("./public/", import.meta.url));

async function serveStatic(res, name) {
	if (!Object.hasOwn(STATIC, name)) return false;
	send(res, 200, await readFile(staticDir + name), { "content-type": `${STATIC[name]}; charset=utf-8`, "cache-control": "public, max-age=300" });
	return true;
}

async function login(req, res, url) {
	const next = safeNext(url.searchParams.get("next"));
	const typed = url.searchParams.get("instance");
	const instance = config.instance ?? (typed ? normalizeInstance(typed) : null);
	if (!instance) {
		const error = typed ? "Enter an instance address like xitter.social." : "";
		return html(res, views.signIn({ next, error, instance: typed ?? "" }), error ? 400 : 200);
	}
	try {
		const { url: authorize, state, verifier } = await startSignIn(instance);
		db.saveState(state, { verifier, instance, next });
		// the state also lives in this browser, so a sign-in can only finish
		// where it started
		redirect(res, authorize, { "set-cookie": cookie(STATE_COOKIE, state, 600) });
	} catch (e) {
		if (!(e instanceof XitterError)) throw e;
		if (config.instance) return show(res, views.message("Couldn't sign in", e.message, { status: 502 }));
		html(res, views.signIn({ next, error: e.message, instance: typed }), 400);
	}
}

async function callback(req, res, url) {
	const state = url.searchParams.get("state") ?? "";
	const expected = cookies(req)[STATE_COOKIE];
	const clear = cookie(STATE_COOKIE, "", 0);
	const pending = state && expected === state ? db.takeState(state) : undefined;
	if (!pending) return html(res, views.message("Sign-in expired", "That sign-in link is stale or was opened in another browser. Please sign in again.").html, 400, { "set-cookie": clear });
	if (url.searchParams.get("error")) return redirect(res, pending.next, { "set-cookie": clear });
	const code = url.searchParams.get("code") ?? "";
	try {
		const profile = await finishSignIn(pending.instance, code, pending.verifier);
		const user = db.upsertUser(profile);
		const token = db.createSession(user.id);
		res.setHeader("set-cookie", [clear, cookie(SESSION_COOKIE, token, 30 * 86400)]);
		redirect(res, pending.next);
	} catch (e) {
		if (!(e instanceof XitterError)) throw e;
		html(res, views.message("Couldn't sign in", e.message).html, 502, { "set-cookie": clear });
	}
}

function ownForm(id, user) {
	const form = db.ownedForm(id, user.id);
	// someone else's form looks the same as no form
	if (!form) throw new HttpError(404, "That form doesn't exist.");
	return form;
}

async function respond(req, res, form, user) {
	const owner = user?.id === form.owner_id;
	if (!form.accepting && !owner) return html(res, views.gate({ form, user, kind: "closed" }), 403);
	if (form.settings.requireSignIn && !user) return html(res, views.gate({ form, user, kind: "signin" }), req.method === "GET" ? 200 : 401);
	if (form.settings.oneResponse && db.hasResponded(form.id, user.id)) return html(res, views.gate({ form, user, kind: "answered" }), req.method === "GET" ? 200 : 409);
	// only a form that asks people to sign in records who they are
	const respondent = form.settings.requireSignIn ? user : undefined;
	if (req.method === "GET") return html(res, views.respond({ form, user, preview: owner }));

	checkOrigin(req);
	const params = await formBody(req);
	if (user) checkCsrf(user, params.get("csrf"));
	const { answers, errors, values, ok } = readSubmission(form, params);
	if (!ok) return html(res, views.respond({ form, user, values, errors, preview: owner }), 422);
	db.addResponse(form.id, respondent?.id, answers);
	html(res, views.thanks({ form, user, responses: form.settings.showResults ? db.listResponses(form.id) : null }));
}

async function route(req, res) {
	const url = new URL(req.url, config.publicUrl);
	const path = url.pathname;
	const method = req.method;
	const token = cookies(req)[SESSION_COOKIE];
	const user = db.sessionUser(token);
	let m;

	if (method === "GET" && path.startsWith("/static/") && (await serveStatic(res, path.slice(8)))) return;
	if (method === "GET" && path === "/client-metadata.json")
		return send(res, 200, JSON.stringify(clientMetadataDocument()), { "content-type": "application/json", "cache-control": "public, max-age=300" });
	if (method === "GET" && path === "/healthz") return send(res, 200, "ok", { "content-type": "text/plain" });

	if (method === "GET" && path === "/") return html(res, user ? views.dashboard(user, db.listForms(user.id)) : views.landing());
	if (method === "GET" && path === "/login") return login(req, res, url);
	if (method === "GET" && path === "/auth/callback") return callback(req, res, url);
	if (method === "POST" && path === "/logout") {
		checkOrigin(req);
		if (user) checkCsrf(user, (await formBody(req)).get("csrf"));
		db.deleteSession(token);
		return redirect(res, "/", { "set-cookie": cookie(SESSION_COOKIE, "", 0) });
	}

	if ((m = /^\/f\/([A-Za-z0-9_-]{1,32})$/.exec(path)) && (method === "GET" || method === "POST")) {
		const form = db.getForm(m[1]);
		if (!form) throw new HttpError(404, "That form doesn't exist. Check the link with whoever shared it.");
		return respond(req, res, form, user);
	}

	// everything below belongs to a signed-in form owner
	if (!user) {
		if (method === "GET") return redirect(res, `/login?next=${encodeURIComponent(path + url.search)}`);
		throw new HttpError(401, "Sign in first.");
	}

	if (method === "POST" && path === "/forms") {
		checkOrigin(req);
		checkCsrf(user, (await formBody(req)).get("csrf"));
		return redirect(res, `/forms/${db.createForm(user.id)}/edit`);
	}

	if ((m = /^\/forms\/([A-Za-z0-9_-]{1,32})\/edit$/.exec(path)) && method === "GET") {
		const form = ownForm(m[1], user);
		return html(res, views.builder(user, form, db.listResponses(form.id).length));
	}

	if ((m = /^\/api\/forms\/([A-Za-z0-9_-]{1,32})$/.exec(path)) && (method === "PUT" || method === "DELETE")) {
		checkOrigin(req);
		checkCsrf(user, req.headers["x-csrf-token"]);
		const form = ownForm(m[1], user);
		if (method === "DELETE") {
			db.deleteForm(form.id);
			return json(res, { ok: true });
		}
		if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "Send JSON.");
		let input;
		try {
			input = JSON.parse(await body(req));
		} catch {
			throw new HttpError(400, "That isn't valid JSON.");
		}
		const clean = sanitizeForm(input);
		db.updateForm(form.id, clean);
		return json(res, { ok: true, form: { id: form.id, ...clean } });
	}

	if ((m = /^\/forms\/([A-Za-z0-9_-]{1,32})\/responses(\.csv)?$/.exec(path)) && method === "GET") {
		const form = ownForm(m[1], user);
		const responses = db.listResponses(form.id);
		if (m[2]) {
			const filename = `${form.title.replace(/[^\w -]+/g, "").trim().slice(0, 60) || "responses"}.csv`;
			return send(res, 200, toCsv(form, responses), { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"` });
		}
		return html(res, views.responsesPage(user, form, responses));
	}

	if ((m = /^\/forms\/([A-Za-z0-9_-]{1,32})\/(accepting|responses\/delete)$/.exec(path)) && method === "POST") {
		checkOrigin(req);
		const params = await formBody(req);
		checkCsrf(user, params.get("csrf"));
		const form = ownForm(m[1], user);
		if (m[2] === "accepting") db.setAccepting(form.id, params.get("accepting") === "1");
		else db.deleteResponses(form.id);
		return redirect(res, `/forms/${form.id}/responses`);
	}

	throw new HttpError(404, "There's nothing at this address.");
}

export function createServer() {
	return http.createServer(async (req, res) => {
		try {
			await route(req, res);
		} catch (e) {
			const status = e instanceof HttpError ? e.status : 500;
			if (status === 500) console.error(e);
			if (res.headersSent) return res.end();
			const text = status === 500 ? "Something went wrong on our side." : e.message;
			const user = (() => {
				try {
					return db.sessionUser(cookies(req)[SESSION_COOKIE]);
				} catch {}
			})();
			if ((req.headers.accept ?? "").includes("application/json") || req.url.startsWith("/api/")) return json(res, { error: text }, status);
			show(res, views.message(status === 404 ? "Not found" : "Something's not right", text, { user, status }));
		}
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	createServer().listen(config.port, () => {
		console.log(`${config.appName} on ${config.publicUrl}`);
		console.log(config.instance ? `Signing in with ${config.instance}` : "People sign in with the Xitter instance of their choice");
		if (config.usesMetadataDocument && !/^https:\/\/[^:/]+\/\S+/.test(config.clientId))
			console.warn("Warning: without XITTER_CLIENT_ID, PUBLIC_URL must be an https address with no port, or Xitter won't accept our client metadata document. See README.");
	});
}
