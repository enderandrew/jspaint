// Colors > Blue Screen Brush (src/blue-screen-brush.js): picks a wide Brush that paints the blue screen of death;
// after enough strokes it "crashes" to a full-screen blue screen that any key dismisses (the picture is untouched);
// picking a palette color or the menu item again turns it off and puts things back.
import { assert, canvas_box, click_menu_item, open_paint } from "./helpers.mjs";

const { page, close } = await open_paint();
const state = () => page.evaluate(async () => ({
	tool: selected_tool.id,
	pattern: selected_colors.foreground instanceof CanvasPattern,
	foreground: String(selected_colors.foreground),
	brush_size,
	checked: (await import("./src/blue-screen-brush.js")).is_blue_screen_brush_active(), // what the menu check mark shows
	crashed: Boolean(document.querySelector(".blue-screen-crash")),
}));
const blue_pixels = () => page.evaluate(() => {
	const d = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data;
	let blue = 0;
	for (let i = 0; i < d.length; i += 4) { if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0xaa) { blue++; } }
	return blue;
});
const c = await canvas_box(page);
const stroke = async (n) => {
	const y = c.y + 30 + (n % 12) * 40;
	await page.mouse.move(c.x + 30, y);
	await page.mouse.down();
	await page.mouse.move(c.x + 400, y + 10, { steps: 6 });
	await page.mouse.up();
	await page.waitForTimeout(60);
};

const before = await state();
assert.equal(before.pattern, false);

// On: the Brush, wide, with blue-screen "colors"
await click_menu_item(page, "Blue Screen Brush");
await page.waitForTimeout(200);
let now = await state();
assert.equal(now.tool, "TOOL_BRUSH");
assert.equal(now.pattern, true);
assert.ok(now.brush_size >= 32);
assert.equal(now.checked, true);

// It paints the blue screen (blue background with white text)
await stroke(0);
assert.ok(await blue_pixels() > 5000, "painted blue screen");
const white_text = await page.evaluate(() => {
	const d = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data;
	let blue = 0, white = 0;
	for (let i = 0; i < d.length; i += 4) {
		if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0xaa) { blue++; }
		if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255) { white++; }
	}
	return { blue, white };
});
assert.ok(white_text.white > 0 && white_text.blue > 0);

// After 10 strokes, it crashes
for (let n = 1; n < 9; n++) { await stroke(n); }
assert.equal((await state()).crashed, false);
await stroke(9);
await page.waitForTimeout(500);
assert.equal((await state()).crashed, true, "fatal exception");
assert.match(await page.evaluate(() => document.querySelector(".blue-screen-crash").textContent), /A fatal exception 0E has occurred/);
const picture_before_key = await page.evaluate(() => Array.from(main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data).join());
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
assert.equal((await state()).crashed, false, "any key continues");
assert.equal(await page.evaluate(() => Array.from(main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data).join()), picture_before_key, "nothing lost");
assert.match(await page.evaluate(() => document.querySelector(".status-text").textContent), /recovered from a fatal exception/);

// Off from the menu: the colors and brush size come back
await click_menu_item(page, "Blue Screen Brush");
await page.waitForTimeout(200);
now = await state();
assert.equal(now.pattern, false);
assert.equal(now.foreground, before.foreground);
assert.equal(now.brush_size, before.brush_size);
assert.equal(now.checked, false);

// Picking a palette color turns it off too
await click_menu_item(page, "Blue Screen Brush");
await page.waitForTimeout(200);
await page.click(".color-button >> nth=13");
await page.waitForTimeout(200);
now = await state();
assert.equal(now.pattern, false);
assert.notEqual(now.foreground, before.foreground, "the picked color");
assert.equal(await page.evaluate(() => selected_colors.background instanceof CanvasPattern), false, "the background color is back");
assert.equal(now.checked, false);
assert.equal(now.brush_size, before.brush_size);

await close();
console.log("blue-screen-brush: ok");
