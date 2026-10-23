// AI > Content-Aware Fill (src/ai-content-aware-fill.js): with nothing selected, a tip; with a selection, after "Would you like help?",
// the selected thing is really gone (filled in from its surroundings) and the assistant (images/clippy.jpg) sits in the middle.
// One undoable step; closing the question changes nothing.
import { assert, canvas_box, click_menu_item, open_paint, select_tool } from "./helpers.mjs";

const { page, close } = await open_paint();
// A stand-in for images/clippy.jpg (the real one isn't in the repo): a dark gray shape on a white background
await page.route("**/images/clippy.jpg", (route) => route.fulfill({
	contentType: "image/svg+xml",
	body: `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="100"><rect width="60" height="100" fill="#fff"/><rect x="20" y="10" width="20" height="80" fill="#555"/></svg>`,
}));
const click_button = (label) => page.evaluate((label) => [...document.querySelectorAll(".window button")].find((b) => b.textContent === label && b.offsetParent).click(), label);
const visible_text = () => page.evaluate(() => [...document.querySelectorAll(".window")].filter((w) => w.offsetParent).map((w) => w.textContent).join("\n"));

// A blue picture with a red thing in it
await page.evaluate(async () => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Test picture" }, () => {
		main_ctx.fillStyle = "#3366cc";
		main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);
		main_ctx.fillStyle = "#ff0000";
		main_ctx.fillRect(120, 100, 100, 80);
	});
});
const picture = () => page.evaluate(() => Array.from(main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data));
const original = await picture();
const red_pixels = () => page.evaluate(() => {
	const d = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data;
	let red = 0;
	for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] < 80 && d[i + 2] < 80) { red++; } }
	return red;
});
assert.equal(await red_pixels(), 100 * 80);

// Nothing selected: a tip
await click_menu_item(page, "Content-Aware Fill");
await page.waitForTimeout(400);
assert.match(await visible_text(), /Select the part you want removed first/);
await click_button("OK");

// Select the red thing (and some blue around it)
await select_tool(page, "Select");
const c = await canvas_box(page);
await page.mouse.move(c.x + 100, c.y + 80);
await page.mouse.down();
await page.mouse.move(c.x + 240, c.y + 200, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(200);
const box = await page.evaluate(() => ({ x: selection.x, y: selection.y, width: selection.width, height: selection.height }));

// Closing the question changes nothing
await click_menu_item(page, "Content-Aware Fill");
await page.waitForTimeout(400);
assert.match(await visible_text(), /Would you like help\?/);
await page.evaluate(() => [...document.querySelectorAll(".window")].find((w) => w.offsetParent && /Would you like help/.test(w.textContent)).querySelector(".window-close-button").click());
await page.waitForTimeout(300);
assert.equal(await page.evaluate(() => main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data.length > 0 && selection !== null), true);

// Fill it in
await click_menu_item(page, "Content-Aware Fill");
await page.waitForTimeout(400);
await click_button("No, but fill it in anyway"); // same thing
await page.waitForTimeout(400);
assert.match(await page.evaluate(() => document.querySelector(".status-text").textContent), /I removed that for you/);
await page.evaluate(async () => { (await import("./src/functions.js")).deselect(); });
await page.waitForTimeout(200);

assert.equal(await red_pixels(), 0, "the red thing is gone");
const result = await page.evaluate(([original, box]) => {
	const d = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data;
	const near = (i, [r, g, b], tolerance) => Math.abs(d[i] - r) <= tolerance && Math.abs(d[i + 1] - g) <= tolerance && Math.abs(d[i + 2] - b) <= tolerance;
	let outside_changed = 0, inside_blue = 0, inside_assistant = 0, inside = 0;
	for (let y = 0; y < main_canvas.height; y++) {
		for (let x = 0; x < main_canvas.width; x++) {
			const i = (y * main_canvas.width + x) * 4;
			if (x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) {
				inside++;
				if (near(i, [0x33, 0x66, 0xcc], 6)) { inside_blue++; }
				if (near(i, [0x55, 0x55, 0x55], 6)) { inside_assistant++; }
			} else if (d[i] !== original[i] || d[i + 1] !== original[i + 1] || d[i + 2] !== original[i + 2]) {
				outside_changed++;
			}
		}
	}
	const center = ((box.y + Math.floor(box.height / 2)) * main_canvas.width + box.x + Math.floor(box.width / 2)) * 4;
	return { outside_changed, inside_blue, inside_assistant, inside, center_is_assistant: near(center, [0x55, 0x55, 0x55], 6) };
}, [original, box]);
assert.equal(result.outside_changed, 0, "outside the selection is untouched");
assert.ok(result.inside_blue > result.inside * 0.6, `filled in with the surroundings (${result.inside_blue} of ${result.inside})`);
assert.ok(result.inside_assistant > 200, `the assistant moved in (${result.inside_assistant} pixels)`);
assert.ok(result.center_is_assistant, "in the middle");

// One undo brings the red thing back
await page.keyboard.press("Control+z");
await page.waitForTimeout(300);
await page.evaluate(async () => { (await import("./src/functions.js")).deselect(); });
await page.waitForTimeout(200);
assert.equal(await red_pixels(), 100 * 80, "undo restores");
assert.deepEqual(await picture(), original);

await close();
console.log("ai-content-aware-fill: ok");
