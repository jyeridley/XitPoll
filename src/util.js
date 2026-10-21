import { createHash, randomBytes } from "node:crypto";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const randomId = (bytes = 9) => randomBytes(bytes).toString("base64url");

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);

// "xitter.social", "@xitter.social" or "https://xitter.social/home" -> "https://xitter.social"
export function normalizeInstance(input, { allowHttp = false } = {}) {
	let value = String(input ?? "").trim().replace(/^@+/, "");
	if (!value || value.length > 255) return null;
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
	try {
		const url = new URL(value);
		if (url.username || url.password) return null;
		if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) return null;
		return url.origin;
	} catch {
		return null;
	}
}

// only same-site paths, so a sign-in link can't bounce people elsewhere
export function safeNext(value) {
	const path = String(value ?? "");
	return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
}
