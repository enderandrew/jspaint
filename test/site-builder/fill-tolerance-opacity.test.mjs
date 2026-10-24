// Fill With Color's tolerance (in its tool options) and Adjustments › Opacity.
/* global transparency:writable */
import { assert, canvas_box, click_menu_item, open_paint, select_tool } from "./helpers.mjs";

const { page, close } = await open_paint();
const pixel = (x, y) => page.evaluate(([x, y]) => [...main_ctx.getImageData(x, y, 1, 1).data], [x, y]);
const undo = () => page.evaluate(async () => { (await import("./src/functions.js")).undo(); });

// Two shades of gray, 8 apart (about 3%), side by side, walled off by black
await page.evaluate(async () => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Test" }, () => {
		main_ctx.fillStyle = "#000"; main_ctx.fillRect(0, 0, 300, 200);
		main_ctx.fillStyle = "#808080"; main_ctx.fillRect(10, 10, 100, 100);
		main_ctx.fillStyle = "#888888"; main_ctx.fillRect(110, 10, 100, 100);
	});
	selected_colors.foreground = "#ff0000";
});
const c = await canvas_box(page);
const click_canvas = async (x, y, options) => { await page.mouse.click(c.x + x, c.y + y, options); await page.waitForTimeout(150); };

// The Fill tool's options: tolerances, 0% to start (MS Paint's behavior)
await select_tool(page, "Fill With Color");
const options = await page.evaluate(() => [...document.querySelectorAll(".choose-fill-tolerance .chooser-option")].filter((o) => o.offsetParent).map((o) => o.textContent));
assert.deepEqual(options, ["0%", "10%", "25%", "50%", "75%"]);
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".choose-fill-tolerance .chooser-option")).backgroundColor) !== "rgba(0, 0, 0, 0)", true, "0% is chosen");

// 0%: just the shade clicked
await click_canvas(50, 50);
assert.deepEqual(await pixel(50, 50), [255, 0, 0, 255]);
assert.deepEqual(await pixel(150, 50), [136, 136, 136, 255], "the other shade isn't filled");
await undo();

// 10%: both shades, but not the black around them
const choose = (label) => page.evaluate((label) => [...document.querySelectorAll(".choose-fill-tolerance .chooser-option")].find((o) => o.textContent === label).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })), label);
await choose("10%");
await page.waitForTimeout(100);
assert.equal(await page.evaluate(async () => (await import("./src/image-manipulation.js")).get_fill_tolerance()), 10);
await click_canvas(50, 50);
assert.deepEqual(await pixel(50, 50), [255, 0, 0, 255]);
assert.deepEqual(await pixel(150, 50), [255, 0, 0, 255], "the similar shade is filled too");
assert.deepEqual(await pixel(5, 5), [0, 0, 0, 255], "black isn't similar");
assert.deepEqual(await pixel(250, 150), [0, 0, 0, 255]);
await undo();

// Filling with a color close to the one clicked finishes (filled pixels still look like the region)
await page.evaluate(() => { selected_colors.foreground = "#858585"; });
await click_canvas(50, 50);
assert.deepEqual(await pixel(150, 50), [133, 133, 133, 255]);
await undo();
await page.evaluate(() => { selected_colors.foreground = "#ff0000"; });

// Shift+click replaces the color everywhere, with the tolerance too
await page.evaluate(async () => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Test" }, () => { main_ctx.fillStyle = "#848484"; main_ctx.fillRect(250, 150, 20, 20); }); // an island, apart from the rest
});
await page.keyboard.down("Shift");
await click_canvas(50, 50);
await page.keyboard.up("Shift");
assert.deepEqual(await pixel(260, 160), [255, 0, 0, 255], "the island is replaced too");
assert.deepEqual(await pixel(5, 5), [0, 0, 0, 255]);
await undo();
await undo();

// 75%: nearly everything, black included (from mid-gray, black is about 50% away)
await choose("75%");
await click_canvas(50, 50);
assert.deepEqual(await pixel(5, 5), [255, 0, 0, 255]);
await undo();
await choose("0%");

// Adjustments › Opacity, for the whole picture: see-through, and a transparent document
await click_menu_item(page, "Opacity...");
await page.waitForSelector(".adjustment-slider-opacity");
await page.$eval(".adjustment-slider-opacity", (input) => { input.value = "40"; input.dispatchEvent(new Event("input", { bubbles: true })); });
await page.waitForTimeout(100);
assert.equal((await pixel(50, 50))[3], 102, "previewed");
await page.evaluate(() => [...document.querySelectorAll(".adjustment-window button")].find((b) => b.textContent === "OK").click());
await page.waitForTimeout(200);
assert.deepEqual(await pixel(50, 50), [128, 128, 128, 102]);
assert.equal(await page.evaluate(() => current_history_node.name), "Opacity");
assert.equal(await page.evaluate(() => transparency), true, "the document is transparent now");
await undo();
assert.equal((await pixel(50, 50))[3], 255, "undo");

// ...and Cancel puts it back
await click_menu_item(page, "Opacity...");
await page.waitForSelector(".adjustment-slider-opacity");
await page.$eval(".adjustment-slider-opacity", (input) => { input.value = "10"; input.dispatchEvent(new Event("input", { bubbles: true })); });
await page.waitForTimeout(100);
await page.evaluate(() => [...document.querySelectorAll(".adjustment-window button")].find((b) => b.textContent === "Cancel").click());
await page.waitForTimeout(100);
assert.equal((await pixel(50, 50))[3], 255, "cancel");

// For a selection: just the selection, which then shows what's under it
await page.evaluate(() => { transparency = false; }); // (as after Image › Attributes › Opaque; undo doesn't change that setting back)
await select_tool(page, "Select");
await page.mouse.move(c.x + 20, c.y + 20);
await page.mouse.down();
await page.mouse.move(c.x + 60, c.y + 60, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(200);
await click_menu_item(page, "Opacity...");
await page.waitForSelector(".adjustment-slider-opacity");
await page.$eval(".adjustment-slider-opacity", (input) => { input.value = "50"; input.dispatchEvent(new Event("input", { bubbles: true })); });
await page.waitForTimeout(100);
await page.evaluate(() => [...document.querySelectorAll(".adjustment-window button")].find((b) => b.textContent === "OK").click());
await page.waitForTimeout(200);
assert.equal(await page.evaluate(() => selection.source_canvas.ctx.getImageData(10, 10, 1, 1).data[3]), 128);
assert.equal(await page.evaluate(() => transparency), false, "a selection doesn't make the document transparent");

await close();
console.log("fill-tolerance-opacity: ok");
