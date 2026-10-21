// A stand-in Xitter for tests and local development. It follows the real
// server's OAuth rules (src/oauth.ts in Xittered/xitter): PKCE S256, single-use
// codes bound to the exact redirect, and /api/v1/me answering { data: user }.
// Authorization approves straight away as whichever account is "signed in".
//
//   node test/mock-xitter.js   # http://127.0.0.1:4000, client ID 123456789
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";

export const ACCOUNTS = {
	alice: { id: "1001", screen_name: "alice", name: "Alice", avatar_url: null },
	bob: { id: "1002", screen_name: "bob", name: "Bob <b>", avatar_url: null },
};

export function startMockXitter({ clientId = "123456789", accounts = ACCOUNTS } = {}) {
	const codes = new Map(), tokens = new Map();
	let signedIn = Object.keys(accounts)[0];
	let origin;

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url, "http://x");
		const reply = (status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
		if (url.pathname === "/.well-known/oauth-authorization-server")
			return reply(200, { issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/oauth/token`, code_challenge_methods_supported: ["S256"], client_id_metadata_document_supported: true });
		if (url.pathname === "/oauth/authorize") {
			const p = url.searchParams;
			if (p.get("client_id") !== clientId || p.get("code_challenge_method") !== "S256" || p.get("response_type") !== "code" || !["read", "write"].includes(p.get("scope")) || (p.get("state") ?? "").length < 8)
				return reply(400, { error: "invalid_request" });
			const code = randomBytes(32).toString("base64url");
			codes.set(code, { user: signedIn, challenge: p.get("code_challenge"), redirect: p.get("redirect_uri") });
			const back = new URL(p.get("redirect_uri"));
			back.searchParams.set("code", code);
			back.searchParams.set("state", p.get("state"));
			return res.writeHead(303, { location: back.href }).end();
		}
		if (url.pathname === "/oauth/token" && req.method === "POST") {
			let raw = "";
			for await (const chunk of req) raw += chunk;
			const f = new URLSearchParams(raw);
			const grant = codes.get(f.get("code"));
			codes.delete(f.get("code"));
			const challenge = createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url");
			if (!grant || grant.challenge !== challenge || grant.redirect !== f.get("redirect_uri") || f.get("client_id") !== clientId) return reply(400, { error: "invalid_grant" });
			const token = `xit_${randomBytes(24).toString("hex")}`;
			tokens.set(token, grant.user);
			return reply(200, { access_token: token, token_type: "Bearer", scope: "read", expires_in: 30 * 86400 });
		}
		if (url.pathname === "/api/v1/me") {
			const user = tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
			return user ? reply(200, { data: accounts[user] }) : reply(401, { error: "unauthorized" });
		}
		reply(404, { error: "not found" });
	});

	return {
		listen: (port, host = "127.0.0.1") => new Promise((resolve) => server.listen(port, host, () => resolve((origin = `http://${host}:${server.address().port}`)))),
		close: () => server.close(),
		signInAs: (name) => void (signedIn = name),
	};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const mock = startMockXitter();
	const origin = await mock.listen(Number(process.env.MOCK_PORT || 4000));
	console.log(`Mock Xitter on ${origin}; everyone signs in as @alice`);
	console.log(`Run the app with: XITTER_INSTANCE=${origin} XITTER_CLIENT_ID=123456789 npm start`);
}
