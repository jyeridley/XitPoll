import { normalizeInstance } from "./util.js";

const env = process.env;
const port = Number(env.PORT || 3000);
const publicUrl = (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, "");

const instanceInput = env.XITTER_INSTANCE || "";
const instance = instanceInput ? normalizeInstance(instanceInput, { allowHttp: true }) : null;
if (instanceInput && !instance) throw new Error(`XITTER_INSTANCE isn't a usable URL: ${instanceInput}`);

const registeredClientId = env.XITTER_CLIENT_ID || "";
if (registeredClientId && !instance) throw new Error("XITTER_CLIENT_ID belongs to one instance: set XITTER_INSTANCE to that instance's URL as well");

export const config = {
	port,
	publicUrl,
	publicOrigin: new URL(publicUrl).origin,
	appName: env.APP_NAME || "XitPoll",
	dbPath: env.DATABASE_PATH || "data/xitpoll.db",
	// null: people pick their own instance when signing in
	instance,
	// A client ID registered at /account/apps/developer on one instance, or the
	// URL of our client metadata document, which every Xitter accepts without
	// registering (it must be served over https from a host without a port)
	clientId: registeredClientId || `${publicUrl}/client-metadata.json`,
	usesMetadataDocument: !registeredClientId,
	redirectUri: `${publicUrl}/auth/callback`,
	secureCookies: publicUrl.startsWith("https://"),
};
