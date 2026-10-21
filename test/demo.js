// Try XitPoll without a Xitter instance: starts the mock Xitter and the app
// together, with the settings already filled in. Works the same on Windows,
// macOS and Linux.
//
//   npm run demo   # then open http://localhost:3000
import { startMockXitter } from "./mock-xitter.js";

const mock = startMockXitter({ clientId: "123456789" });
const origin = await mock.listen(Number(process.env.MOCK_PORT || 4000));

process.env.XITTER_INSTANCE = origin;
process.env.XITTER_CLIENT_ID = "123456789";
process.env.DATABASE_PATH ||= "data/demo.db";
// the mock signs everyone in as @alice; make her staff
process.env.XITPOLL_STAFF ||= "alice";

const { config } = await import("../src/config.js");
const { createServer } = await import("../server.js");
createServer().listen(config.port, () => {
	console.log(`Mock Xitter on ${origin} (everyone signs in as @alice)`);
	console.log(`XitPoll demo on ${config.publicUrl}  <- open this in your browser`);
	console.log("Press Ctrl+C to stop.");
});
