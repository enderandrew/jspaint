// Image > Defragment Canvas (src/defragment.js): after an animated "defragmenter" dialog, the picture's pixels are
// really sorted by color (same pixels, new order, white "free space" last). One undoable step; Stop changes nothing.
import { assert, click_menu_item, open_paint } from "./helpers.mjs";

const { page, close } = await open_paint();

// Stripes of a few colors, mixed up
await page.evaluate(async () => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Test picture" }, () => {
		const colors = ["#ff0000", "#ffffff", "#0000ff", "#00aa00", "#ffff00", "#808080"];
		for (let x = 0; x < main_canvas.width; x += 10) {
			for (let y = 0; y < main_canvas.height; y += 10) {
				main_ctx.fillStyle = colors[(x / 10 * 7 + y / 10 * 3) % colors.length];
				main_ctx.fillRect(x, y, 10, 10);
			}
		}
	});
});
const picture = () => page.evaluate(() => Array.from(new Uint32Array(main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data.buffer)));
const original = await picture();
const histogram = (pixels) => {
	const counts = new Map();
	for (const p of pixels) { counts.set(p, (counts.get(p) ?? 0) + 1); }
	return [...counts].sort((a, b) => a[0] - b[0]);
};
const visible_text = () => page.evaluate(() => [...document.querySelectorAll(".window")].filter((w) => w.offsetParent).map((w) => w.textContent).join("\n"));

// Stop changes nothing
await click_menu_item(page, "Defragment Canvas...");
await page.waitForSelector(".defragment-window canvas", { timeout: 5000 });
await page.waitForTimeout(1000);
assert.match(await visible_text(), /Defragmenting file system/);
await page.evaluate(() => [...document.querySelectorAll(".defragment-window button")].find((b) => b.textContent === "Stop").click());
await page.waitForTimeout(7500);
assert.deepEqual(await picture(), original, "stopped: no change");

// Defragmenting: the same pixels, sorted by color, white last
await click_menu_item(page, "Defragment Canvas...");
await page.waitForFunction(() => /Defragmentation of your picture is complete/.test(document.body.textContent), null, { timeout: 15000 });
const sorted = await picture();
assert.deepEqual(histogram(sorted), histogram(original), "no pixels lost or added");
assert.notDeepEqual(sorted, original);
const in_order = await page.evaluate(async () => {
	const { cluster_key } = await import("./src/defragment.js");
	const d = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data;
	let previous = -1;
	for (let i = 0; i < d.length; i += 4) {
		const key = cluster_key(d[i], d[i + 1], d[i + 2], d[i + 3]);
		if (key < previous) { return false; }
		previous = key;
	}
	const last = d.length - 4;
	return d[last] === 255 && d[last + 1] === 255 && d[last + 2] === 255; // free space at the end
});
assert.equal(in_order, true, "sorted by color, with white at the end");
assert.match(await page.evaluate(() => document.querySelector(".status-text").textContent), /480,000 pixels are now contiguous/);
await page.evaluate(() => [...document.querySelectorAll(".window button")].find((b) => b.textContent === "OK" && b.offsetParent).click());

// One undo restores it
await page.keyboard.press("Control+z");
await page.waitForTimeout(300);
assert.deepEqual(await picture(), original, "undo restores");

await close();
console.log("defragment: ok");
