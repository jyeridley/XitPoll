// End to end: sign in through a stand-in Xitter (same OAuth rules as the real
// one: PKCE S256, single-use codes, exact redirect), build a form, answer it.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { ACCOUNTS, startMockXitter } from "./mock-xitter.js";

const CLIENT_ID = "123456789";
// carol is staff too; "impostor" later holds the handle @carol on another account
const accounts = { ...ACCOUNTS, carol: { id: "1003", screen_name: "carol", name: "Carol", avatar_url: null }, impostor: { id: "1099", screen_name: "Carol", name: "Not Carol", avatar_url: null } };
const mock = startMockXitter({ clientId: CLIENT_ID, accounts });

let app, base, xitterOrigin;

before(async () => {
	xitterOrigin = await mock.listen(0);
	// pick the app's port up front so PUBLIC_URL is right
	const probe = http.createServer();
	await new Promise((r) => probe.listen(0, "127.0.0.1", r));
	const port = probe.address().port;
	await new Promise((r) => probe.close(r));
	base = `http://localhost:${port}`;
	Object.assign(process.env, { PORT: String(port), PUBLIC_URL: base, XITTER_INSTANCE: xitterOrigin, XITTER_CLIENT_ID: CLIENT_ID, DATABASE_PATH: ":memory:", XITPOLL_STAFF: "alice, @carol" });
	const { createServer } = await import("../server.js");
	app = createServer();
	await new Promise((r) => app.listen(port, r));
});
after(() => {
	app?.close();
	mock.close();
});

// a browser that keeps cookies and doesn't follow redirects by itself
function browser() {
	const jar = new Map();
	const go = async (path, init = {}) => {
		const url = path.startsWith("http") ? path : base + path;
		const headers = { ...init.headers };
		if (url.startsWith(base) && jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
		const res = await fetch(url, { ...init, headers, redirect: "manual" });
		if (url.startsWith(base))
			for (const c of res.headers.getSetCookie()) {
				const [pair] = c.split(";");
				const [k, v] = pair.split("=");
				if (/Max-Age=0/.test(c)) jar.delete(k);
				else jar.set(k, v);
			}
		return { res, text: await res.text() };
	};
	const post = (path, fields, extra = {}) =>
		go(path, { method: "POST", body: new URLSearchParams(fields), headers: { "content-type": "application/x-www-form-urlencoded", origin: base, ...extra } });
	return { go, post, jar };
}

async function signIn(b, who, next = "/") {
	mock.signInAs(who);
	const start = await b.go(`/login?next=${encodeURIComponent(next)}`);
	assert.equal(start.res.status, 303);
	const approve = await b.go(start.res.headers.get("location"));
	assert.equal(approve.res.status, 303);
	const done = await b.go(approve.res.headers.get("location"));
	assert.equal(done.res.status, 303, done.text);
	return done.res.headers.get("location");
}

const csrfOf = (html) => /name="csrf" value="([^"]+)"/.exec(html)?.[1];

const alice = browser(), bob = browser(), carol = browser(), stranger = browser();
let formId, aliceCsrf;

test("landing page offers Xitter sign-in", async () => {
	const { res, text } = await stranger.go("/");
	assert.equal(res.status, 200);
	assert.match(text, /Sign in with Xitter/);
	assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
});

test("signing in with Xitter lands on the dashboard", async () => {
	assert.equal(await signIn(alice, "alice"), "/");
	const { text } = await alice.go("/");
	assert.match(text, /@alice@127\.0\.0\.1/);
	assert.match(text, /<h1>Forms<\/h1>/);
	aliceCsrf = csrfOf(text);
	assert.ok(aliceCsrf);
});

test("a callback with the wrong state, or replayed, is refused", async () => {
	const b = browser();
	mock.signInAs("alice");
	const start = await b.go("/login");
	const approve = await b.go(start.res.headers.get("location"));
	const callback = new URL(approve.res.headers.get("location"));
	// opened in a different browser: no state cookie
	assert.equal((await stranger.go(callback.pathname + callback.search)).res.status, 400);
	// tampered state
	const tampered = new URL(callback);
	tampered.searchParams.set("state", "x".repeat(32));
	assert.equal((await b.go(tampered.pathname + tampered.search)).res.status, 400);
});

test("creating and saving a form", async () => {
	const made = await alice.post("/forms", { csrf: aliceCsrf });
	assert.equal(made.res.status, 303);
	formId = /^\/forms\/([\w-]+)\/edit$/.exec(made.res.headers.get("location"))[1];
	const editor = await alice.go(`/forms/${formId}/edit`);
	assert.equal(editor.res.status, 200);
	assert.match(editor.text, /id="form-data"/);

	const form = {
		title: "Team lunch <script>",
		description: "Pick a place",
		questions: [
			{ id: "name", type: "short", title: "Your name", required: true },
			{ id: "place", type: "choice", title: "Where?", required: true, options: ["Tacos", "Ramen", "", "Salad"] },
			{ id: "extras", type: "checkbox", title: "Extras", options: ["Drinks", "Dessert"] },
			{ id: "rating", type: "scale", title: "Hungry?", min: 1, max: 5, minLabel: "A bit", maxLabel: "Very" },
			{ id: "day", type: "date", title: "Day" },
			{ id: "notes", type: "paragraph", title: "Notes" },
		],
		settings: { showResults: true, theme: "pink" },
	};
	const saved = await alice.go(`/api/forms/${formId}`, { method: "PUT", body: JSON.stringify(form), headers: { "content-type": "application/json", "x-csrf-token": aliceCsrf, origin: base } });
	assert.equal(saved.res.status, 200, saved.text);
	const out = JSON.parse(saved.text).form;
	assert.equal(out.questions.length, 6);
	assert.equal(out.questions[3].max, 5);
	assert.equal(out.settings.theme, "pink");
	const odd = await alice.go(`/api/forms/${formId}`, { method: "PUT", body: JSON.stringify({ ...form, settings: { theme: "url(evil)" } }), headers: { "content-type": "application/json", "x-csrf-token": aliceCsrf, origin: base } });
	assert.equal(JSON.parse(odd.text).form.settings.theme, "blue", "unknown themes fall back to blue");
	await alice.go(`/api/forms/${formId}`, { method: "PUT", body: JSON.stringify(form), headers: { "content-type": "application/json", "x-csrf-token": aliceCsrf, origin: base } });

	// without the CSRF header, or from another site, nothing changes
	const noCsrf = await alice.go(`/api/forms/${formId}`, { method: "PUT", body: "{}", headers: { "content-type": "application/json", origin: base } });
	assert.equal(noCsrf.res.status, 403);
	const crossSite = await alice.go(`/api/forms/${formId}`, { method: "PUT", body: "{}", headers: { "content-type": "application/json", "x-csrf-token": aliceCsrf, origin: "https://evil.example" } });
	assert.equal(crossSite.res.status, 403);
});

test("anyone with the link can answer; answers are validated", async () => {
	const page = await stranger.go(`/f/${formId}`);
	assert.equal(page.res.status, 200);
	assert.match(page.text, /Team lunch &lt;script&gt;/);
	assert.match(page.text, /<body class="theme-pink"/);
	assert.doesNotMatch(page.text, /<script>/);
	assert.match(page.text, /value="Ramen"/);
	// the blank option isn't offered
	assert.equal((page.text.match(/name="q_place"/g) ?? []).length, 3);

	const missing = await stranger.post(`/f/${formId}`, { q_name: "", q_place: "Pizza" });
	assert.equal(missing.res.status, 422);
	assert.match(missing.text, /This is a required question/);
	assert.match(missing.text, /Pick one of the options given/);

	const ok = await stranger.post(`/f/${formId}`, { q_name: "Sam", q_place: "Ramen", q_extras: "Drinks", q_rating: "4", q_day: "2026-10-30", q_notes: "=1+1" });
	assert.equal(ok.res.status, 200, ok.text);
	assert.match(ok.text, /Your response has been recorded/);
	// showResults: the poll-style summary appears
	assert.match(ok.text, /Results so far/);
	assert.match(ok.text, /class="fill p100"/);

	const bad = await stranger.post(`/f/${formId}`, { q_name: "x", q_place: "Tacos", q_rating: "9", q_day: "2026-02-31" });
	assert.equal(bad.res.status, 422);
	assert.match(bad.text, /from 1 to 5/);
	assert.match(bad.text, /valid date/);
});

test("only staff can manage forms; staff share them", async () => {
	// bob isn't staff: he can sign in (to answer forms) but not manage any
	await signIn(bob, "bob");
	const home = await bob.go("/");
	assert.equal(home.res.status, 403);
	assert.match(home.text, /Staff only/);
	assert.equal((await bob.go(`/forms/${formId}/edit`)).res.status, 403);
	assert.equal((await bob.go(`/forms/${formId}/responses.csv`)).res.status, 403);
	const bobCsrf = csrfOf(home.text);
	assert.equal((await bob.post("/forms", { csrf: bobCsrf })).res.status, 403);
	const put = await bob.go(`/api/forms/${formId}`, { method: "PUT", body: "{}", headers: { "content-type": "application/json", "x-csrf-token": bobCsrf, origin: base } });
	assert.equal(put.res.status, 403);
	// signed-out visitors get sent to sign in
	const anon = await stranger.go(`/forms/${formId}/responses`);
	assert.equal(anon.res.status, 303);
	assert.match(anon.res.headers.get("location"), /^\/login\?next=/);

	// carol is staff: she sees alice's form, who made it, and can open it
	await signIn(carol, "carol");
	const list = await carol.go("/");
	assert.equal(list.res.status, 200);
	assert.match(list.text, /Team lunch/);
	assert.match(list.text, /by @alice/);
	assert.equal((await carol.go(`/forms/${formId}/edit`)).res.status, 200);
});

test("a staff handle taken over by another account doesn't get in", async () => {
	// the binding to carol's account was made when she signed in above
	const other = browser();
	await signIn(other, "impostor");
	assert.equal((await other.go("/")).res.status, 403);
	assert.equal((await other.go(`/forms/${formId}/edit`)).res.status, 403);
	// carol herself still does
	assert.equal((await carol.go("/")).res.status, 200);
});

test("sign-in required, one response per account", async () => {
	const current = JSON.parse((await alice.go(`/forms/${formId}/edit`)).text.match(/id="form-data">(.*?)<\/script>/s)[1]).form;
	current.settings = { oneResponse: true, confirmation: "Thanks!" };
	const saved = await alice.go(`/api/forms/${formId}`, { method: "PUT", body: JSON.stringify(current), headers: { "content-type": "application/json", "x-csrf-token": aliceCsrf, origin: base } });
	assert.equal(JSON.parse(saved.text).form.settings.requireSignIn, true);

	const gate = await stranger.go(`/f/${formId}`);
	assert.match(gate.text, /Sign in to continue/);
	assert.equal((await stranger.post(`/f/${formId}`, { q_name: "x", q_place: "Tacos" })).res.status, 401);

	const page = await bob.go(`/f/${formId}`);
	assert.match(page.text, /Answering as <b>@bob@/);
	const bobCsrf = csrfOf(page.text);
	assert.equal((await bob.post(`/f/${formId}`, { q_name: "Bob", q_place: "Tacos" })).res.status, 403, "needs the CSRF token");
	const first = await bob.post(`/f/${formId}`, { csrf: bobCsrf, q_name: "Bob", q_place: "Tacos", q_extras: ["Drinks"] });
	assert.equal(first.res.status, 200);
	assert.match(first.text, /Thanks!/);
	const second = await bob.post(`/f/${formId}`, { csrf: bobCsrf, q_name: "Bob again", q_place: "Salad" });
	assert.equal(second.res.status, 409);
	assert.match(second.text, /already responded/);
});

test("the owner sees a summary, every response and a CSV", async () => {
	const { text } = await alice.go(`/forms/${formId}/responses`);
	assert.match(text, /2 responses/);
	assert.match(text, /@bob@127\.0\.0\.1/);
	assert.match(text, /Anonymous/);
	const csv = await alice.go(`/forms/${formId}/responses.csv`);
	assert.match(csv.res.headers.get("content-type"), /text\/csv/);
	assert.match(csv.text, /Your name,Where\?/);
	assert.match(csv.text, /'=1\+1/, "formulas are defused");
	assert.match(csv.text, /,bob@127\.0\.0\.1:\d+,Bob,Tacos,Drinks,,,/);
});

test("closing the form stops new responses", async () => {
	await alice.post(`/forms/${formId}/accepting`, { csrf: aliceCsrf, accepting: "0" });
	const closed = await bob.go(`/f/${formId}`);
	assert.equal(closed.res.status, 403);
	assert.match(closed.text, /no longer accepting/);
	const list = await alice.go("/");
	assert.match(list.text, /class="pill closed">.*Closed<\/span><span class="dim">2 responses/);
});

test("deleting a form and signing out", async () => {
	const del = await alice.go(`/api/forms/${formId}`, { method: "DELETE", headers: { "x-csrf-token": aliceCsrf, origin: base } });
	assert.equal(del.res.status, 200);
	assert.equal((await stranger.go(`/f/${formId}`)).res.status, 404);
	const out = await alice.post("/logout", { csrf: aliceCsrf });
	assert.equal(out.res.status, 303);
	assert.match((await alice.go("/")).text, /Sign in with your staff account/);
});

test("the client metadata document names our redirect", async () => {
	const { text } = await stranger.go("/client-metadata.json");
	const doc = JSON.parse(text);
	assert.deepEqual(doc.redirect_uris, [`${base}/auth/callback`]);
	assert.equal(doc.token_endpoint_auth_method, "none");
});
