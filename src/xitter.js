// Sign in with Xitter: OAuth 2 authorization code with PKCE (S256), as a
// public client. Xitter has no client secrets; the verifier does the proving.
// See src/oauth.ts and /api on any Xitter instance.
import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { config } from "./config.js";

export class XitterError extends Error {}

// Addresses we never call when someone types an instance in: loopback,
// private, link-local, CGNAT, documentation, multicast and reserved ranges
const RESERVED = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]])
	RESERVED.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["::", 127], ["64:ff9b::", 96], ["100::", 64], ["2001::", 32], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]])
	RESERVED.addSubnet(address, prefix, "ipv6");

function reserved(address) {
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
	if (mapped) return RESERVED.check(mapped, "ipv4");
	return RESERVED.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

// The configured instance is trusted; one a visitor types must be a public
// https host
async function checkInstance(origin) {
	if (origin === config.instance) return;
	const { hostname, protocol } = new URL(origin);
	if (protocol !== "https:" || isIP(hostname.replace(/^\[|\]$/g, "")) || !hostname.includes("."))
		throw new XitterError("Enter the address of a public Xitter instance, like xitter.social.");
	const addresses = await lookup(hostname, { all: true }).catch(() => []);
	if (!addresses.length) throw new XitterError(`Couldn't find ${hostname}.`);
	if (addresses.some((a) => reserved(a.address))) throw new XitterError(`${hostname} isn't a public address.`);
}

async function call(url, init = {}) {
	let res;
	try {
		res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(8000), headers: { accept: "application/json", ...init.headers } });
	} catch {
		throw new XitterError(`Couldn't reach ${new URL(url).host}.`);
	}
	const text = await res.text();
	if (text.length > 256 * 1024) throw new XitterError("The instance sent an unexpectedly large answer.");
	let body;
	try {
		body = JSON.parse(text);
	} catch {}
	return { ok: res.ok, status: res.status, body };
}

const discovered = new Map();

// RFC 8414 metadata, falling back to Xitter's own paths. Endpoints must stay
// on the instance itself.
async function endpoints(origin) {
	const hit = discovered.get(origin);
	if (hit && Date.now() - hit.at < 3600_000) return hit;
	await checkInstance(origin);
	const { ok, body } = await call(`${origin}/.well-known/oauth-authorization-server`).catch(() => ({}));
	const meta = ok && body && typeof body === "object" ? body : {};
	const pick = (value, path) => {
		try {
			const url = new URL(value);
			if (url.origin === origin) return url.href;
		} catch {}
		return origin + path;
	};
	const found = {
		at: Date.now(),
		authorize: pick(meta.authorization_endpoint, "/oauth/authorize"),
		token: pick(meta.token_endpoint, "/oauth/token"),
		// older instances can't take a metadata document URL as a client_id
		metadataDocuments: meta.client_id_metadata_document_supported === true,
	};
	if (config.usesMetadataDocument && !found.metadataDocuments)
		throw new XitterError(`${new URL(origin).host} doesn't support sign-in from apps that aren't registered there. Ask its admin to update Xitter.`);
	if (discovered.size > 500) discovered.clear();
	discovered.set(origin, found);
	return found;
}

// where to send someone to approve signing in, and what to keep until they're back
export async function startSignIn(origin) {
	const { authorize } = await endpoints(origin);
	const verifier = randomBytes(48).toString("base64url");
	const state = randomBytes(24).toString("base64url");
	const url = new URL(authorize);
	url.search = new URLSearchParams({
		response_type: "code",
		client_id: config.clientId,
		redirect_uri: config.redirectUri,
		// read is the smallest scope; it's enough to learn who someone is
		scope: "read",
		state,
		code_challenge: createHash("sha256").update(verifier).digest("base64url"),
		code_challenge_method: "S256",
	}).toString();
	return { url: url.href, state, verifier };
}

// trade the code for a token, then ask who it belongs to. The token is not
// kept: XitPoll only needs to know who signed in.
export async function finishSignIn(origin, code, verifier) {
	const { token } = await endpoints(origin);
	const exchanged = await call(token, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: config.clientId, redirect_uri: config.redirectUri, code_verifier: verifier }),
	});
	const access = exchanged.body?.access_token;
	if (!exchanged.ok || typeof access !== "string") throw new XitterError("Xitter didn't accept the sign-in. Try again.");
	const me = await call(`${origin}/api/v1/me`, { headers: { authorization: `Bearer ${access}` } });
	const user = me.body?.data ?? me.body;
	if (!me.ok || !user || typeof user.id !== "string" && typeof user.id !== "number" || typeof user.screen_name !== "string")
		throw new XitterError("Couldn't read your Xitter profile.");
	const avatar = typeof user.avatar_url === "string" && /^https?:\/\//.test(user.avatar_url) ? user.avatar_url : null;
	return { instance: origin, id: String(user.id), screen_name: user.screen_name.slice(0, 64), name: String(user.name ?? "").slice(0, 100), avatar_url: avatar };
}

// the document a Xitter instance fetches when our client_id is its URL
export function clientMetadataDocument() {
	return {
		client_id: config.clientId,
		client_name: config.appName,
		client_uri: config.publicUrl,
		redirect_uris: [config.redirectUri],
		grant_types: ["authorization_code"],
		response_types: ["code"],
		token_endpoint_auth_method: "none",
		scope: "read",
	};
}
