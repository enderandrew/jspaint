// Extras › Multi-User (sessions.js): start a session from the picture, join it from another copy of Paint (by
// pasting its link, as you would inside a page that embeds Paint and has no address bar), see each other's
// drawing and cursor, and leave. The picture is kept as tiles (tile-sync.js), and a change sends only the tiles it
// touched; a session saved the old way (one PNG of the whole picture) still opens, and moves to tiles. Firebase is replaced by a small in-page stand-in whose database lives here in
// the test (so two browsers share it); the real SDK in lib/firebase/ is checked separately to load and set up.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, click_menu_item, open_paint } from "./helpers.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---- the shared database ----
let store = {};
const pages = [];
/** Every write sessions.js made, in order. */
const writes = [];
const set_at = (parts, value) => {
	if (parts.length === 0) { store = value ?? {}; return; }
	let node = store;
	for (const part of parts.slice(0, -1)) {
		if (typeof node[part] !== "object" || node[part] === null) { node[part] = {}; }
		node = node[part];
	}
	const last = parts[parts.length - 1];
	if (value == null) { delete node[last]; } else { node[last] = value; }
};
const write = async ({ path: at, op, value }) => {
	writes.push({ path: at, op, value });
	const parts = at.split("/").filter(Boolean);
	if (op === "update") {
		for (const [key, v] of Object.entries(value)) { set_at([...parts, ...key.split("/").filter(Boolean)], v); }
	} else {
		set_at(parts, value);
	}
	const snapshot = JSON.parse(JSON.stringify(store));
	await Promise.all(pages.map((page) => page.evaluate((s) => window.__fb_sync?.(s), snapshot).catch(() => {})));
};

// The in-page stand-in for the Firebase compat API that sessions.js uses
const FAKE_FIREBASE = `
(() => {
	let store = {};
	const listeners = [];
	const parts_of = (path) => path.split("/").filter(Boolean);
	const get = (path) => { let node = store; for (const part of parts_of(path)) { if (node == null) return null; node = node[part]; } return node ?? null; };
	const snapshot = (path) => ({ key: parts_of(path).pop() ?? null, ref: ref(path), val: () => { const v = get(path); return v == null ? null : JSON.parse(JSON.stringify(v)); } });
	const fire = (listener) => {
		if (listener.type === "value") {
			const json = JSON.stringify(get(listener.path));
			if (json !== listener.last) { listener.last = json; listener.cb(snapshot(listener.path)); }
		} else if (listener.type === "child_added") {
			for (const key of Object.keys(get(listener.path) ?? {})) {
				if (!listener.seen.has(key)) { listener.seen.add(key); listener.cb(snapshot(listener.path + "/" + key)); }
			}
		}
	};
	window.__fb_sync = (s) => { store = s; for (const listener of [...listeners]) { if (listeners.includes(listener)) fire(listener); } };
	window.__fb_disconnect = [];
	function ref(path) {
		return {
			key: parts_of(path).pop() ?? null,
			child: (name) => ref(path ? path + "/" + name : name),
			push: () => ref((path ? path + "/" : "") + "u" + Math.random().toString(36).slice(2, 10)),
			set: (value) => window.__fb_write({ path, op: "set", value: value ?? null }),
			update: (value) => window.__fb_write({ path, op: "update", value }),
			remove: () => window.__fb_write({ path, op: "set", value: null }),
			onDisconnect: () => ({ remove: () => { window.__fb_disconnect.push(path); } }),
			once: () => Promise.resolve(snapshot(path)),
			on: (type, cb) => { const listener = { path, type, cb, last: undefined, seen: new Set() }; listeners.push(listener); setTimeout(() => fire(listener)); },
			off: (type, cb) => { const i = listeners.findIndex((l) => l.path === path && l.type === type && l.cb === cb); if (i !== -1) listeners.splice(i, 1); },
			toString: () => "fake-firebase:/" + path,
		};
	}
	const app = { database: () => ({ ref: (path) => ref(path === "/" ? "" : path) }) };
	window.firebase = { apps: [], app: () => app, initializeApp: (config) => { window.__fb_config = config; window.firebase.apps.push(app); return app; } };
})();
`;

// (served with the database as it is right now, as the real SDK would have it once connected)
const fake_firebase = () => FAKE_FIREBASE.replace("let store = {};", `let store = ${JSON.stringify(store)};`);

const open_copy = async () => {
	const copy = await open_paint();
	await copy.page.exposeFunction("__fb_write", write);
	await copy.page.route("**/lib/firebase/firebase-app-compat.js", (route) => route.fulfill({ contentType: "text/javascript", body: fake_firebase() }));
	await copy.page.route("**/lib/firebase/firebase-database-compat.js", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
	pages.push(copy.page);
	return copy;
};
const pixel = (page, x, y) => page.evaluate(([x, y]) => [...main_ctx.getImageData(x, y, 1, 1).data], [x, y]);
const paint_rect = (page, color, x, y) => page.evaluate(async ([color, x, y]) => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Test" }, () => { main_ctx.fillStyle = color; main_ctx.fillRect(x, y, 40, 30); });
}, [color, x, y]);
const dialog_text = (page) => page.evaluate(() => [...document.querySelectorAll(".window")].filter((w) => w.offsetParent).map((w) => w.textContent).join("\n"));
const press_button = (page, label) => page.evaluate((label) => [...document.querySelectorAll(".window button")].filter((b) => b.offsetParent && b.textContent.trim() === label).pop().click(), label);
const menu_enabled = async (page, label) => {
	// opening the Multi-User submenu updates which of its items are enabled
	await page.evaluate(() => [...document.querySelectorAll(".menu-button")].find((b) => b.textContent.trim() === "Extras").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
	await page.waitForTimeout(100);
	await click_menu_item(page, "Multi-User");
	await page.waitForTimeout(200);
	const enabled = await page.evaluate((label) => document.querySelector(`[role=menuitem][aria-label="${label}"]`)?.getAttribute("aria-disabled") !== "true", label);
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	return enabled;
};

const a = await open_copy();
const b = await open_copy();

// The menu: Leave is for when you're in a session
assert.equal(await menu_enabled(a.page, "Leave Session"), false);
assert.equal(await menu_enabled(a.page, "New Session From Document"), true);

// A starts a session from its picture (a red rectangle)
await paint_rect(a.page, "#f00", 20, 20);
await click_menu_item(a.page, "New Session From Document");
await a.page.waitForSelector("#session-name");
assert.match(await dialog_text(a.page), /make the current document public/);
await a.page.fill("#session-name", "paint-party");
await press_button(a.page, "Start");
await a.page.waitForFunction(() => location.hash.includes("session:paint-party"), null, { timeout: 5000 });
await a.page.waitForSelector(".multi-user-link", { timeout: 10000 });
assert.match(await dialog_text(a.page), /You're in the multi-user session paint-party/);
const link = await a.page.$eval(".multi-user-link", (input) => input.value);
assert.match(link, /^http:\/\/localhost:11822\/#session:paint-party$/);
await press_button(a.page, "OK");
await a.page.waitForFunction(() => window.__fb_config?.databaseURL, null, { timeout: 5000 });
await new Promise((resolve) => { setTimeout(resolve, 600); });
const picture = store["paint-party"]?.picture;
assert.ok(picture, "the picture is in the database");
const canvas_size = await a.page.evaluate(() => [main_canvas.width, main_canvas.height]);
assert.deepEqual([picture.width, picture.height], canvas_size);
assert.equal(Object.keys(picture.tiles).length, Math.ceil(canvas_size[0] / 64) * Math.ceil(canvas_size[1] / 64), "as 64×64 tiles");
assert.ok(Object.values(picture.tiles).every((uri) => /^data:image\/png;base64,/.test(uri)), "each a PNG");
assert.equal(store["paint-party"].data, undefined, "not as one big PNG");
assert.equal(Object.keys(store["paint-party"].users).length, 1, "A is there");
assert.equal(await menu_enabled(a.page, "Leave Session"), true);

// B joins by pasting the link (no address bar needed) and gets A's picture
await click_menu_item(b.page, "Join Session...");
await b.page.waitForSelector("#session-name");
assert.match(await dialog_text(b.page), /Enter the name of the session to join/);
await b.page.fill("#session-name", link);
await press_button(b.page, "Join");
await b.page.waitForFunction(() => location.hash.includes("session:paint-party"), null, { timeout: 5000 });
await b.page.waitForFunction(() => main_ctx.getImageData(30, 30, 1, 1).data[1] === 0, null, { timeout: 10000 });
assert.deepEqual(await pixel(b.page, 30, 30), [255, 0, 0, 255], "B sees A's red rectangle");
await press_button(b.page, "OK");
assert.equal(Object.keys(store["paint-party"].users).length, 2, "both are there");

// B draws; A sees it. Only the tiles the rectangle touched are sent: (200, 100)–(240, 130) is in tiles 3_1 and 3_2.
const writes_before = writes.length;
await paint_rect(b.page, "#00f", 200, 100);
await a.page.waitForFunction(() => main_ctx.getImageData(210, 110, 1, 1).data[0] === 0, null, { timeout: 10000 });
assert.deepEqual(await pixel(a.page, 210, 110), [0, 0, 255, 255], "A sees B's blue rectangle");
assert.equal(await a.page.evaluate(() => current_history_node.name), "Sync Session");
const picture_writes = writes.slice(writes_before).filter((w) => /picture/.test(w.path));
assert.equal(picture_writes.length, 1, `one write for the change: ${JSON.stringify(picture_writes.map((w) => [w.path, w.op]))}`);
assert.equal(picture_writes[0].op, "update");
assert.deepEqual(Object.keys(picture_writes[0].value).sort(), ["tiles/3_1", "tiles/3_2"], "just the tiles it touched");
const bytes_sent = JSON.stringify(picture_writes[0].value).length;
const whole_bytes = await b.page.evaluate(() => main_canvas.toDataURL().length);
assert.ok(bytes_sent < whole_bytes / 5, `sent ${bytes_sent} bytes, not the whole picture's ${whole_bytes}`);
// (and A, receiving it, didn't send it back)
await a.page.waitForTimeout(400);
assert.equal(writes.slice(writes_before).filter((w) => /picture/.test(w.path)).length, 1, "no echo");

// Transparency comes across too: B erases part of A's red rectangle to transparent
await b.page.evaluate(async () => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Clear" }, () => { main_ctx.clearRect(25, 25, 10, 10); });
});
await a.page.waitForFunction(() => main_ctx.getImageData(30, 30, 1, 1).data[3] === 0, null, { timeout: 10000 });
await b.page.evaluate(async () => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Refill" }, () => { main_ctx.fillStyle = "#f00"; main_ctx.fillRect(25, 25, 10, 10); });
});
await a.page.waitForFunction(() => main_ctx.getImageData(30, 30, 1, 1).data[3] === 255, null, { timeout: 10000 });

// B's cursor shows up for A
const canvas = await b.page.$eval(".main-canvas", (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top }; });
await b.page.mouse.move(canvas.x + 100, canvas.y + 80);
await b.page.mouse.move(canvas.x + 120, canvas.y + 90);
await a.page.waitForFunction(() => [...document.querySelectorAll(".user-cursor")].some((c) => c.style.display === "block"), null, { timeout: 5000 });

// Invalid names are caught
await click_menu_item(b.page, "Join Session...");
await b.page.waitForSelector("#session-name");
await b.page.fill("#session-name", "no spaces/or slashes");
await press_button(b.page, "Join");
await b.page.waitForTimeout(300);
assert.match(await dialog_text(b.page), /only numbers, letters, and hyphens/);
await press_button(b.page, "OK");
await press_button(b.page, "Cancel");
b.errors.splice(b.errors.findIndex((e) => /only numbers, letters, and hyphens/.test(e)), 1); // (show_error_message logs it too)

// B leaves: back to a document kept in this browser, with the picture; B's cursor goes away for A
await click_menu_item(b.page, "Leave Session");
await b.page.waitForFunction(() => /#local:/.test(location.hash), null, { timeout: 5000 });
assert.deepEqual(await pixel(b.page, 30, 30), [255, 0, 0, 255], "B keeps the picture");
await a.page.waitForFunction(() => document.querySelectorAll(".user-cursor").length === 0, null, { timeout: 5000 });
assert.equal(Object.keys(store["paint-party"].users).length, 1, "only A is left");

// Paint embedded in another site (an <iframe>, like a web desktop's window) joins too
const host = await a.browser.newPage();
await host.exposeFunction("__fb_write", write);
await host.route("**/lib/firebase/firebase-app-compat.js", (route) => route.fulfill({ contentType: "text/javascript", body: fake_firebase() }));
await host.route("**/lib/firebase/firebase-database-compat.js", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
// (the host is another origin: 127.0.0.1 rather than localhost; any plain page of the server will do)
await host.goto("http://127.0.0.1:11822/lib/pdf.js/README.txt", { waitUntil: "domcontentloaded" });
await host.evaluate(() => { document.body.innerHTML = `<iframe src="http://localhost:11822/" style="width: 1000px; height: 700px"></iframe>`; });
const frame = await (await host.waitForSelector("iframe")).contentFrame();
await frame.waitForSelector(".main-canvas", { timeout: 60000 });
await frame.waitForTimeout(800);
pages.push(/** @type {any} */ (frame));
await click_menu_item(/** @type {any} */ (frame), "Join Session...");
await frame.waitForSelector("#session-name");
await frame.fill("#session-name", "paint-party");
await press_button(/** @type {any} */ (frame), "Join");
await frame.waitForFunction(() => main_ctx.getImageData(210, 110, 1, 1).data[0] === 0, null, { timeout: 10000 });
assert.deepEqual(await pixel(/** @type {any} */ (frame), 30, 30), [255, 0, 0, 255], "the embedded copy has the picture");
assert.equal(await host.evaluate(() => location.href), "http://127.0.0.1:11822/lib/pdf.js/README.txt", "the host page's address is left alone");
assert.equal(Object.keys(store["paint-party"].users).length, 2, "A and the embedded copy");
await host.close();

// The real SDK (lib/firebase/) loads and sets up a database reference
const sdk_page = await a.browser.newPage();
await sdk_page.goto("http://localhost:11822/test/site-builder/README.md");
await sdk_page.addScriptTag({ content: readFileSync(path.join(root, "lib/firebase/firebase-app-compat.js"), "utf8") });
await sdk_page.addScriptTag({ content: readFileSync(path.join(root, "lib/firebase/firebase-database-compat.js"), "utf8") });
const sdk = await sdk_page.evaluate(async () => {
	const app = window.firebase.initializeApp({ apiKey: "test", databaseURL: "https://example-test.firebaseio.com", projectId: "example-test" });
	const ref = app.database().ref("/").child("paint-party").child("users").push();
	const result = { version: window.firebase.SDK_VERSION, url: ref.parent.toString(), has_api: ["on", "off", "set", "update", "remove", "onDisconnect", "child", "push"].every((name) => typeof ref[name] === "function") };
	await app.delete(); // (it would keep trying to reach the made-up database)
	return result;
});
assert.equal(sdk.version, "13.1.0");
assert.equal(sdk.url, "https://example-test.firebaseio.com/paint-party/users");
assert.equal(sdk.has_api, true);
await sdk_page.close();

// A session saved the old way (one PNG at <session>/data) opens from it, and moves to tiles
const old_png = await a.page.evaluate(() => {
	const canvas = document.createElement("canvas");
	canvas.width = 300;
	canvas.height = 200;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#0f0";
	ctx.fillRect(50, 50, 100, 60);
	return canvas.toDataURL("image/png");
});
await write({ path: "old-party/data", op: "set", value: old_png });
await click_menu_item(b.page, "Join Session...");
await b.page.waitForSelector("#session-name");
await b.page.fill("#session-name", "old-party");
await press_button(b.page, "Join");
await b.page.waitForFunction(() => main_canvas.width === 300 && main_ctx.getImageData(60, 60, 1, 1).data[1] === 255, null, { timeout: 10000 });
await press_button(b.page, "OK");
await b.page.waitForTimeout(500);
assert.equal(store["old-party"].data, undefined, "the old PNG is gone");
assert.deepEqual([store["old-party"].picture?.width, store["old-party"].picture?.height], [300, 200]);
assert.equal(Object.keys(store["old-party"].picture.tiles).length, 5 * 4);

await b.close();
await a.close();
console.log("multi-user: ok");
