// Vista Paint features: right-clicking a selection shows its actions (src/selection-menu.js, context-menu.js);
// Edit › Invert Selection; Crop keeps only what's inside a free-form selection's outline (crop.js); and the shape
// tools show outline widths under their fill style (tool-options.js), shared with the Line tool.
/* global stroke_size */
import { assert, open_paint, select_tool } from "./helpers.mjs";

const { page, close } = await open_paint();
const canvas = await page.evaluate(() => { const r = document.querySelector(".main-canvas").getBoundingClientRect(); return { x: r.left, y: r.top }; });
const menu_labels = () => page.evaluate(() => [...document.querySelectorAll(".context-menu .menu-item")].map((el) => `${el.getAttribute("aria-label")}${el.hasAttribute("disabled") ? " (off)" : ""}`));
const menu_open = () => page.evaluate(() => Boolean(document.querySelector(".context-menu")));
const select_rect = async (x1, y1, x2, y2) => {
	await select_tool(page, "Select");
	await page.mouse.move(canvas.x + x1, canvas.y + y1);
	await page.mouse.down();
	await page.mouse.move(canvas.x + x2, canvas.y + y2, { steps: 5 });
	await page.mouse.up();
	await page.waitForTimeout(100);
};
const paint = (color, x, y, w, h) => page.evaluate(async ([color, x, y, w, h]) => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Test" }, () => { main_ctx.fillStyle = color; main_ctx.fillRect(x, y, w, h); });
}, [color, x, y, w, h]);
const pixel = (x, y) => page.evaluate(([x, y]) => [...main_ctx.getImageData(x, y, 1, 1).data], [x, y]);

// --- The right-click menu ---
await paint("#f00", 100, 100, 50, 50);
await select_rect(80, 80, 200, 180);
await page.mouse.click(canvas.x + 120, canvas.y + 120, { button: "right" });
await page.waitForTimeout(200);
assert.ok(await menu_open(), "right-clicking the selection opens the menu");
assert.deepEqual(await menu_labels(), [
	"Cut", "Copy", "Paste", "Clear Selection", "Invert Selection", "Select All",
	"Copy To...", "Paste From...",
	"Flip/Rotate", "Stretch/Skew", "Crop to Selection", "Invert Colors",
]);
assert.equal(await page.evaluate(() => document.querySelectorAll(".context-menu .menu-hr").length), 2, "in three groups");
// Escape closes it, and nothing happened
await page.keyboard.press("Escape");
assert.equal(await menu_open(), false);
assert.ok(await page.evaluate(() => Boolean(selection)), "the selection is still there");
// Invert Colors from the menu inverts just the selection
await page.mouse.click(canvas.x + 120, canvas.y + 120, { button: "right" });
await page.waitForTimeout(200);
await page.evaluate(() => [...document.querySelectorAll(".context-menu .menu-item")].find((el) => el.getAttribute("aria-label") === "Invert Colors").click());
await page.waitForTimeout(200);
assert.equal(await menu_open(), false, "it closes after a choice");
assert.match(await page.evaluate(() => current_history_node.name), /^Invert Colors/);
await page.evaluate(async () => { (await import("./src/functions.js")).deselect(); });
assert.deepEqual(await pixel(120, 120), [0, 255, 255, 255], "red became cyan");
assert.deepEqual(await pixel(300, 300), [255, 255, 255, 255], "outside the selection is untouched");
// Without a selection, with the Select tool: the menu opens with the selection's actions off
await select_tool(page, "Select");
await page.mouse.click(canvas.x + 400, canvas.y + 300, { button: "right" });
await page.waitForTimeout(200);
const labels = await menu_labels();
assert.ok(labels.includes("Cut (off)") && labels.includes("Crop to Selection (off)") && labels.includes("Paste") && labels.includes("Select All"), JSON.stringify(labels));
// Keyboard: arrows to Select All, Enter
await page.keyboard.press("End"); // Invert Colors
for (let i = 0; i < 4; i++) { await page.keyboard.press("ArrowUp"); } // Stretch/Skew, Flip/Rotate, Paste From, Select All (skipping the ones that are off)
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
assert.deepEqual(await page.evaluate(() => selection && [selection.x, selection.y, selection.width, selection.height]), await page.evaluate(() => [0, 0, main_canvas.width, main_canvas.height]), "Select All, by keyboard");
await page.evaluate(async () => { (await import("./src/functions.js")).deselect(); });
// Clicking elsewhere closes it
await page.mouse.click(canvas.x + 400, canvas.y + 300, { button: "right" });
await page.waitForTimeout(200);
await page.mouse.click(5, 5);
assert.equal(await menu_open(), false);
// A right-drag is a selection, not a menu
await select_tool(page, "Select");
await page.mouse.move(canvas.x + 300, canvas.y + 300);
await page.mouse.down({ button: "right" });
await page.mouse.move(canvas.x + 380, canvas.y + 360, { steps: 5 });
await page.mouse.up({ button: "right" });
await page.waitForTimeout(200);
assert.equal(await menu_open(), false, "no menu after a right-drag");
await page.evaluate(async () => { (await import("./src/functions.js")).deselect(); });
// With a drawing tool, right-clicking the canvas draws (no menu)
await select_tool(page, "Pencil");
await page.mouse.click(canvas.x + 500, canvas.y + 400, { button: "right" });
await page.waitForTimeout(200);
assert.equal(await menu_open(), false, "drawing tools keep the right button");

// --- Invert Selection ---
await page.evaluate(async () => { (await import("./src/functions.js")).reset_canvas_and_history(); });
await paint("#00f", 0, 0, 800, 600);
await paint("#f00", 100, 100, 50, 50);
await select_rect(100, 100, 150, 150);
await page.evaluate(async () => { (await import("./src/selection-menu.js")).invert_selection(); });
assert.deepEqual(await page.evaluate(() => [selection.x, selection.y, selection.width, selection.height, selection.free_form]), await page.evaluate(() => [0, 0, main_canvas.width, main_canvas.height, true]), "everything else is selected");
// Clearing it leaves just the old selection's square
await page.evaluate(async () => { (await import("./src/functions.js")).delete_selection(); });
assert.deepEqual(await pixel(120, 120), [255, 0, 0, 255], "the old selection is kept");
assert.deepEqual(await pixel(20, 20), [255, 255, 255, 255], "the rest was selected, and cleared");

// --- Crop with a free-form selection keeps just its outline ---
await page.evaluate(async () => { (await import("./src/functions.js")).reset_canvas_and_history(); });
await paint("#00f", 0, 0, 800, 600);
await select_tool(page, "Free-Form Select");
await page.mouse.move(canvas.x + 100, canvas.y + 100);
await page.mouse.down();
for (const [x, y] of [[300, 100], [100, 300], [100, 100]]) { await page.mouse.move(canvas.x + x, canvas.y + y, { steps: 6 }); } // a triangle
await page.mouse.up();
await page.waitForTimeout(100);
await page.evaluate(async () => { (await import("./src/crop.js")).crop_to_selection(); });
const size = await page.evaluate(() => [main_canvas.width, main_canvas.height]);
assert.ok(Math.abs(size[0] - 200) <= 2 && Math.abs(size[1] - 200) <= 2, `cropped to the triangle's box: ${size}`);
assert.deepEqual(await pixel(20, 20), [0, 0, 255, 255], "inside the triangle: the picture");
assert.deepEqual(await pixel(190, 190), [255, 255, 255, 255], "outside it: the background color");
assert.equal(await page.evaluate(() => selection), null);
await page.evaluate(async () => { (await import("./src/functions.js")).undo(); });
assert.deepEqual(await page.evaluate(() => [main_canvas.width, main_canvas.height]), [800, 600], "undone in one step");

// --- Outline widths for the shapes ---
await page.evaluate(async () => { (await import("./src/functions.js")).reset_canvas_and_history(); });
await select_tool(page, "Rectangle");
const options = await page.evaluate(() => {
	const box = document.querySelector(".tool-options");
	return { tall: box.classList.contains("tall-tool-options"), styles: box.querySelectorAll(".choose-shape-style .chooser-option").length, widths: box.querySelectorAll(".choose-shape-stroke-size .chooser-option").length, height: box.getBoundingClientRect().height };
});
assert.deepEqual([options.tall, options.styles, options.widths], [true, 3, 5], "fill styles, then five widths");
assert.ok(options.height > 100, "the options box is taller for them");
// Pick the widest and draw: the outline is 5 pixels wide
await page.evaluate(() => [...document.querySelectorAll(".choose-shape-stroke-size .chooser-option")][4].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
await page.waitForTimeout(100);
assert.equal(await page.evaluate(() => stroke_size), 5);
await page.mouse.move(canvas.x + 100, canvas.y + 100);
await page.mouse.down();
await page.mouse.move(canvas.x + 200, canvas.y + 180, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(100);
const edge = await page.evaluate(() => { const d = main_ctx.getImageData(100, 140, 8, 1).data; return [0, 1, 2, 3, 4, 5].map((i) => d[i * 4 + 3] && d[i * 4] < 128 ? 1 : 0); });
assert.deepEqual(edge, [1, 1, 1, 1, 1, 0], "a 5-pixel outline");
// The Line tool shows the same width (one setting, as in Paint)
await select_tool(page, "Line");
assert.equal(await page.evaluate(() => [...document.querySelectorAll(".tool-options .choose-stroke-size .chooser-option")].findIndex((o) => o.style.backgroundColor && o.style.backgroundColor !== "rgb(192, 192, 192)" && getComputedStyle(o).backgroundColor !== "rgba(0, 0, 0, 0)")), 4, "the Line tool's fifth width is chosen too");
assert.equal(await page.evaluate(() => document.querySelector(".tool-options").classList.contains("tall-tool-options")), false, "and its box is the usual height");
// The fill style still works (filled with no outline: Ellipse)
await select_tool(page, "Ellipse");
await page.evaluate(() => [...document.querySelectorAll(".tool-options .choose-shape-style .chooser-option")][2].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
assert.deepEqual(await page.evaluate(async () => {
	const { get_tool_by_id } = await import("./src/functions.js");
	const { TOOL_ELLIPSE } = await import("./src/tools.js");
	const tool = get_tool_by_id(TOOL_ELLIPSE);
	return [tool.$options.fill, tool.$options.stroke];
}), [true, false], "filled with no outline, read through the tool as before");

await close();
console.log("selection-menu: ok");
