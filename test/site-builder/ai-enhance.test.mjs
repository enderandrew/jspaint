// AI > Enhance! (src/ai-enhance.js), the parody AI upscaler: after a fake progress dialog it pixelates the picture,
// with bigger blocks each time; it's one undoable step; Cancel changes nothing; with a selection, only that is enhanced.
import { assert, canvas_box, click_menu_item, open_paint, select_tool } from "./helpers.mjs";

const { page, close } = await open_paint();

// A picture with detail in every pixel (gradients), as an undoable step
await page.evaluate(async () => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Test picture" }, () => {
		const data = main_ctx.createImageData(main_canvas.width, main_canvas.height);
		for (let y = 0; y < data.height; y++) {
			for (let x = 0; x < data.width; x++) {
				const i = (y * data.width + x) * 4;
				data.data.set([(x * 3) % 256, (y * 5) % 256, ((x + y) * 7) % 256, 255], i);
			}
		}
		main_ctx.putImageData(data, 0, 0);
	});
});
const picture = () => page.evaluate(() => Array.from(main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data));
const original = await picture();

/** Whether every full `block` x `block` square in the region is a single color. */
const blocky = (block, { x = 0, y = 0, width = null, height = null } = {}) => page.evaluate(([block, x, y, width, height]) => {
	width = width ?? main_canvas.width;
	height = height ?? main_canvas.height;
	const d = main_ctx.getImageData(x, y, width, height).data;
	for (let by = 0; by + block <= height; by += block) {
		for (let bx = 0; bx + block <= width; bx += block) {
			const first = (by * width + bx) * 4;
			for (let yy = by; yy < by + block; yy++) {
				for (let xx = bx; xx < bx + block; xx++) {
					const i = (yy * width + xx) * 4;
					if (d[i] !== d[first] || d[i + 1] !== d[first + 1] || d[i + 2] !== d[first + 2]) { return false; }
				}
			}
		}
	}
	return true;
}, [block, x, y, width, height]);
const enhance = async () => {
	await click_menu_item(page, "Enhance!");
	await page.waitForSelector(".ai-enhance-window progress", { timeout: 5000 });
	await page.waitForFunction(() => !document.querySelector(".ai-enhance-window") || !document.querySelector(".ai-enhance-window").offsetParent, null, { timeout: 10000 });
	await page.waitForTimeout(200);
};
const status = () => page.evaluate(() => document.querySelector(".status-text").textContent);

assert.equal(await blocky(4), false, "the test picture starts detailed");

// Cancel changes nothing
await click_menu_item(page, "Enhance!");
await page.waitForSelector(".ai-enhance-window progress", { timeout: 5000 });
await page.evaluate(() => [...document.querySelectorAll(".ai-enhance-window button")].find((b) => b.textContent === "Cancel").click());
await page.waitForTimeout(3200);
assert.deepEqual(await picture(), original, "canceled: no change");

// First Enhance: 4px blocks; second: 8px blocks
await enhance();
assert.equal(await blocky(4), true, "4px blocks");
assert.match(await status(), /1,600% more detail/);
await enhance();
assert.equal(await blocky(8), true, "8px blocks");
assert.match(await status(), /6,400% more detail/);

// Undo, step by step, back to the original
await page.keyboard.press("Control+z");
await page.waitForTimeout(200);
assert.equal(await blocky(4), true);
assert.equal(await blocky(8), false, "undo removes the second Enhance");
await page.keyboard.press("Control+z");
await page.waitForTimeout(200);
assert.deepEqual(await picture(), original, "undo restores the picture");

// With a selection, only the selection is enhanced
await select_tool(page, "Select");
const c = await canvas_box(page);
await page.mouse.move(c.x + 40, c.y + 40);
await page.mouse.down();
await page.mouse.move(c.x + 200, c.y + 160, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(200);
const box = await page.evaluate(() => ({ x: selection.x, y: selection.y, width: selection.width, height: selection.height }));
await enhance();
await page.evaluate(async () => { (await import("./src/functions.js")).deselect(); });
await page.waitForTimeout(200);
const outside_changed = await page.evaluate(([original, box]) => {
	let changed = 0;
	const d = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data;
	for (let y = 0; y < main_canvas.height; y++) {
		for (let x = 0; x < main_canvas.width; x++) {
			if (x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) { continue; }
			const i = (y * main_canvas.width + x) * 4;
			if (d[i] !== original[i] || d[i + 1] !== original[i + 1] || d[i + 2] !== original[i + 2]) { changed++; }
		}
	}
	return changed;
}, [original, box]);
assert.equal(outside_changed, 0, `outside the selection ${JSON.stringify(box)} is untouched`);
assert.equal(await blocky(16, box), true, "the selection got the next block size (16px)");

await close();
console.log("ai-enhance: ok");
