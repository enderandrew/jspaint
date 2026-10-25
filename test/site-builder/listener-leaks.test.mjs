/* global stroke_size */
// Listeners on the page (window) don't pile up: switching tools, and opening and closing windows (dialogs, Help),
// used to leave listeners behind every time, each keeping old tool options or a closed window in memory.
import { assert, open_paint, select_tool } from "./helpers.mjs";

const { page, close } = await open_paint({
	init: () => {
		// Count native listeners on window too (jQuery's are counted from its own records)
		const live = new Map();
		const key = (type) => `${type}`;
		const add = window.addEventListener, remove = window.removeEventListener;
		window.addEventListener = function (type, listener, options) {
			if (this === window && listener) {
				const set = live.get(key(type)) || new Set();
				set.add(listener);
				live.set(key(type), set);
			}
			return add.call(this, type, listener, options);
		};
		window.removeEventListener = function (type, listener, options) {
			if (this === window && listener) { live.get(key(type))?.delete(listener); }
			return remove.call(this, type, listener, options);
		};
		window.__native_listener_count = () => [...live.values()].reduce((sum, set) => sum + set.size, 0);
	},
});
const counts = () => page.evaluate(() => {
	const jquery = Object.values($._data(window, "events") || {}).reduce((sum, list) => sum + list.length, 0);
	return { jquery, native: window.__native_listener_count() };
});
const grew = (before, after) => (after.jquery - before.jquery) + (after.native - before.native);

// Tool switches (each tool once first, for anything a tool sets up the first time it's used)
const tools = ["Brush", "Line", "Fill With Color", "Select", "Eraser/Color Eraser", "Airbrush", "Rectangle", "Magnifier"];
for (const tool of tools) { await select_tool(page, tool); }
let before = await counts();
for (let i = 0; i < 24; i++) { await select_tool(page, tools[i % tools.length]); }
let after = await counts();
assert.ok(grew(before, after) <= 2, `tool switches: ${JSON.stringify([before, after])}`);

// Tool options still work after all that switching
await select_tool(page, "Line");
await page.evaluate(() => [...document.querySelectorAll(".choose-stroke-size .chooser-option")].filter((o) => o.offsetParent)[3].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
await page.waitForTimeout(100);
assert.equal(await page.evaluate(() => stroke_size), 4);
assert.equal(await page.evaluate(() => [...document.querySelectorAll(".choose-stroke-size .chooser-option")].filter((o) => o.offsetParent && o.style.backgroundColor && o.style.backgroundColor !== "rgb(192, 192, 192)").length), 1, "one option highlighted");

// Selections (each has handles): make and drop a few
const make_selection = async () => {
	await select_tool(page, "Select");
	const c = await page.evaluate(() => { const r = document.querySelector(".main-canvas").getBoundingClientRect(); return { x: r.left, y: r.top }; });
	await page.mouse.move(c.x + 30, c.y + 30);
	await page.mouse.down();
	await page.mouse.move(c.x + 120, c.y + 90, { steps: 3 });
	await page.mouse.up();
	await page.waitForTimeout(100);
	await page.evaluate(async () => { (await import("./src/functions.js")).deselect(); });
};
await make_selection();
before = await counts();
for (let i = 0; i < 6; i++) { await make_selection(); }
after = await counts();
assert.ok(grew(before, after) <= 1, `selections: ${JSON.stringify([before, after])}`);
assert.equal(await page.evaluate(() => document.querySelectorAll(".handle").length), await page.evaluate(() => document.querySelectorAll(".canvas-area > .handle").length), "no handles left behind from old selections");

// Windows: open and close each a few times
const top_window_close = () => [...document.querySelectorAll(".window")].filter((w) => w.offsetParent).pop().querySelector(".window-close-button").click();
for (const [name, open] of [
	["Attributes", async () => { (await import("./src/functions.js")).image_attributes(); }],
	["Brightness/Contrast", async () => { (await import("./src/adjustments.js")).show_brightness_contrast(); }],
	["message box", async () => { (await import("./src/msgbox.js")).showMessageBox({ message: "Hi" }); }],
	["Help", async () => { (await import("./src/help.js")).show_help(); }],
]) {
	// (the first one sets up anything that's set up once)
	await page.evaluate(open);
	await page.waitForTimeout(300);
	await page.evaluate(top_window_close);
	await page.waitForTimeout(100);
	before = await counts();
	for (let i = 0; i < 8; i++) {
		await page.evaluate(open);
		await page.waitForTimeout(300);
		await page.evaluate(top_window_close);
		await page.waitForTimeout(100);
	}
	after = await counts();
	assert.ok(grew(before, after) <= 1, `${name}: ${JSON.stringify([before, after])}`);
}

// Windows still drag and focus normally afterwards
await page.evaluate(async () => { (await import("./src/functions.js")).image_attributes(); });
await page.waitForTimeout(300);
const box = await page.evaluate(() => { const w = [...document.querySelectorAll(".window")].filter((el) => el.offsetParent).pop(); const r = w.querySelector(".window-titlebar").getBoundingClientRect(); return { x: r.left + 40, y: r.top + 8, left: w.getBoundingClientRect().left }; });
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await page.mouse.move(box.x + 60, box.y + 30, { steps: 5 });
await page.mouse.up();
assert.equal(await page.evaluate(() => Math.round([...document.querySelectorAll(".window")].filter((el) => el.offsetParent).pop().getBoundingClientRect().left)), Math.round(box.left + 60), "the window dragged");
await page.evaluate(top_window_close);

await close();
console.log("listener-leaks: ok");
