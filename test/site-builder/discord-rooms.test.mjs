// Multi-user in the Discord activity (sessions.js RESTSession, through the activity's server: discord-activity/
// packages/server/src/rooms.ts, used here as it is): the picture goes as tiles, a change sends only the tiles it
// touched, the others get only those tiles, and an idle room isn't asked about every second (a waiting request
// is answered when something changes). It used to upload the whole picture on every change and download it
// every second.
import { assert, open_paint } from "./helpers.mjs";

const { Rooms } = await import("../../discord-activity/packages/server/src/rooms.ts");
const rooms = new Rooms();
const log = [];

const serve_rooms = async (page, who) => {
	await page.route("**/api/rooms/**", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const room = decodeURIComponent(url.pathname.split("/")[3]);
		let reply;
		if (request.method() === "GET") {
			reply = await rooms.get(room, url.searchParams.get("since"), url.searchParams.get("wait") === "1");
		} else {
			reply = rooms.put(room, request.postDataJSON(), request.method() === "PUT");
		}
		const body = reply.body === undefined ? "" : JSON.stringify(reply.body);
		log.push({ who, method: request.method(), status: reply.status, bytes: (request.postData() || "").length + body.length, tiles: Object.keys((request.method() === "GET" ? reply.body : request.postDataJSON())?.tiles || {}) });
		await route.fulfill({ status: reply.status, contentType: "application/json", body }).catch(() => { /* (the page went away) */ });
	});
};
const open_copy = async (who) => {
	const copy = await open_paint({ init: () => { localStorage.setItem("online_session_implementation", "RESTSession"); } });
	await serve_rooms(copy.page, who);
	await copy.page.evaluate(() => { location.hash = "session:discord-room-1"; });
	return copy;
};
const pixel = (page, x, y) => page.evaluate(([x, y]) => [...main_ctx.getImageData(x, y, 1, 1).data], [x, y]);
const paint_rect = (page, color, x, y) => page.evaluate(async ([color, x, y]) => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Test" }, () => { main_ctx.fillStyle = color; main_ctx.fillRect(x, y, 40, 30); });
}, [color, x, y]);

// A opens the room first: its picture becomes the room's (sent whole, once)
const a = await open_copy("A");
await paint_rect(a.page, "#f00", 20, 20);
await a.page.waitForTimeout(1500);
const first = log.filter((entry) => entry.who === "A" && entry.method === "PUT");
assert.equal(first.length, 1, "the whole picture, once");
const tile_count = await a.page.evaluate(() => Math.ceil(main_canvas.width / 64) * Math.ceil(main_canvas.height / 64));
assert.equal(first[0].tiles.length, tile_count, "as tiles");

// B joins and gets it
const b = await open_copy("B");
await b.page.waitForFunction(() => main_ctx.getImageData(30, 30, 1, 1).data[1] === 0, null, { timeout: 10000 });
assert.deepEqual(await pixel(b.page, 30, 30), [255, 0, 0, 255], "B has A's red rectangle");

// B draws: only the tiles it touched go up, and only those come down to A
log.length = 0;
await paint_rect(b.page, "#00f", 200, 100);
await a.page.waitForFunction(() => main_ctx.getImageData(210, 110, 1, 1).data[0] === 0, null, { timeout: 10000 });
assert.deepEqual(await pixel(a.page, 210, 110), [0, 0, 255, 255], "A sees B's blue rectangle");
assert.equal(await a.page.evaluate(() => current_history_node.name), "Sync Session");
const sent = log.filter((entry) => entry.who === "B" && entry.method !== "GET");
assert.deepEqual(sent.map((entry) => [entry.method, entry.tiles.sort()]), [["PATCH", ["3_1", "3_2"]]], "B sent just the tiles it touched");
const received = log.filter((entry) => entry.who === "A" && entry.method === "GET" && entry.status === 200);
assert.equal(received.length, 1);
assert.deepEqual(received[0].tiles.sort(), ["3_1", "3_2"], "A got just those");
const whole_bytes = await b.page.evaluate(() => main_canvas.toDataURL().length);
assert.ok(sent[0].bytes < whole_bytes / 5 && received[0].bytes < whole_bytes / 5, `a change is ${sent[0].bytes} bytes up and ${received[0].bytes} down, not ${whole_bytes}`);
// (A didn't send it back)
await a.page.waitForTimeout(500);
assert.equal(log.filter((entry) => entry.who === "A" && entry.method !== "GET").length, 0, "no echo");

// Idle: no asking every second
log.length = 0;
await a.page.waitForTimeout(5000);
assert.ok(log.filter((entry) => entry.who === "A").length <= 1, `an idle room is barely asked about: ${JSON.stringify(log)}`);

// A resizes: the whole picture goes, and B gets the new size
await a.page.evaluate(async () => { (await import("./src/functions.js")).resize_canvas_and_save_dimensions(300, 200); });
await b.page.waitForFunction(() => main_canvas.width === 300 && main_canvas.height === 200, null, { timeout: 10000 });
assert.deepEqual(await pixel(b.page, 30, 30), [255, 0, 0, 255], "with the picture");

// B leaves; A carries on alone
await b.page.evaluate(() => { location.hash = "local:after-discord"; });
await b.page.waitForTimeout(500);
await paint_rect(a.page, "#0f0", 100, 100);
await a.page.waitForTimeout(800);

await b.close();
await a.close();
console.log("discord-rooms: ok");
