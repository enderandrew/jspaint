// AI Mode (src/ai-mode.js), the parody "AI-assisted painting": every tool reveals the painting hidden under the
// canvas (images/ai-1.jpg) instead of painting. After any action, each pixel is either still blank or the painting;
// undo/redo keep that; saving flattens onto white; turning it off restores the colors; opening another document ends it.
import { assert, canvas_box, click_menu_item, open_paint, select_tool, type_text_box } from "./helpers.mjs";

const { page, close, errors } = await open_paint({ viewport: { width: 1280, height: 1000 } });
// AI Mode finds its paintings by loading images/ai-1.jpg, ai-2.jpg, ... until one is missing,
// so one 404 is expected. Chrome logs it without the URL, so check the responses themselves.
const not_found = [];
page.on("response", (response) => { if (response.status() === 404) { not_found.push(new URL(response.url()).pathname); } });

/** Counts blank pixels, pixels that match the painting, and anything else ("wrong"). */
const audit = () => page.evaluate(async () => {
	const img = new Image();
	img.src = "images/ai-1.jpg";
	await img.decode();
	const reference = document.createElement("canvas");
	reference.width = main_canvas.width;
	reference.height = main_canvas.height;
	const reference_ctx = reference.getContext("2d");
	const scale = Math.max(reference.width / img.naturalWidth, reference.height / img.naturalHeight);
	reference_ctx.drawImage(img, (reference.width - img.naturalWidth * scale) / 2, (reference.height - img.naturalHeight * scale) / 2, img.naturalWidth * scale, img.naturalHeight * scale);
	const a = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data;
	const b = reference_ctx.getImageData(0, 0, reference.width, reference.height).data;
	let blank = 0, painting = 0, wrong = 0;
	const close_enough = (i) => Math.abs(a[i] - b[i]) <= 3 && Math.abs(a[i + 1] - b[i + 1]) <= 3 && Math.abs(a[i + 2] - b[i + 2]) <= 3;
	for (let i = 0; i < a.length; i += 4) {
		if (a[i + 3] === 0) {
			blank++;
		} else if (a[i + 3] === 255 && close_enough(i)) {
			painting++;
		} else {
			wrong++;
		}
	}
	return { blank, painting, wrong };
});
const dismiss = async () => {
	await page.waitForTimeout(300);
	await page.evaluate(() => { for (const button of document.querySelectorAll(".window button")) { if (button.textContent === "OK" && button.offsetParent) { button.click(); } } });
};
const drag = async (points) => {
	const c = await canvas_box(page);
	await page.mouse.move(c.x + points[0][0], c.y + points[0][1]);
	await page.mouse.down();
	for (const [x, y] of points.slice(1)) { await page.mouse.move(c.x + x, c.y + y, { steps: 6 }); }
	await page.mouse.up();
	await page.waitForTimeout(150);
};

// Turning it on: a blank (transparent, shown white) canvas the size of the painting, and "AI ink" colors
await click_menu_item(page, "AI Mode");
await page.waitForFunction(() => document.body.classList.contains("ai-mode"), null, { timeout: 10000 });
await dismiss();
assert.equal(await page.evaluate(() => `${main_canvas.width}x${main_canvas.height}`), "600x800");
let result = await audit();
assert.equal(result.blank, 600 * 800, "starts blank");
assert.ok(await page.evaluate(() => selected_colors.foreground instanceof CanvasPattern && selected_colors.background instanceof CanvasPattern), "AI ink");
assert.equal(await page.evaluate(() => $(".recover-document, .window:visible").filter((_, el) => /became empty/.test(el.textContent)).length), 0, "the blank canvas isn't mistaken for data loss");

// Every tool reveals the painting, and nothing else
await select_tool(page, "Brush");
await drag([[80, 120], [200, 160], [320, 140], [420, 220]]);
await select_tool(page, "Rectangle");
await drag([[120, 250], [300, 420]]);
await select_tool(page, "Eraser/Color Eraser");
await drag([[60, 600], [540, 640]]);
await page.evaluate(() => document.querySelectorAll(".color-button")[13].click()); // a real color from the palette
await select_tool(page, "Pencil");
await drag([[500, 60], [560, 760]]);
await type_text_box(page, "AI ART", { x: 150, y: 470, width: 260, height: 70 });
result = await audit();
assert.equal(result.wrong, 0, "every pixel is blank or the painting");
assert.ok(result.painting > 20000, `strokes revealed the painting (${result.painting} pixels)`);

// Undo and redo stay consistent
const painted = result.painting;
await page.keyboard.press("Control+z");
await page.waitForTimeout(200);
result = await audit();
assert.equal(result.wrong, 0);
assert.ok(result.painting < painted, "undo hides the last stroke again");
await page.keyboard.press("Control+y");
await page.waitForTimeout(200);
result = await audit();
assert.equal(result.wrong, 0);
assert.equal(result.painting, painted, "redo brings it back");

// Saving flattens the blank areas onto white, and doesn't fill them in on the canvas
await page.evaluate(() => {
	window.__saved = [];
	window.systemHooks.showSaveFileDialog = async ({ getBlob, defaultFileFormatID }) => {
		window.__saved.push(await getBlob(defaultFileFormatID));
		return true;
	};
});
await page.keyboard.press("Control+s");
await page.waitForFunction(() => window.__saved.length === 1, null, { timeout: 10000 });
const saved_transparency = await page.evaluate(async () => {
	const img = new Image();
	img.src = URL.createObjectURL(window.__saved[0]);
	await img.decode();
	const c = document.createElement("canvas");
	c.width = img.width;
	c.height = img.height;
	const x = c.getContext("2d");
	x.drawImage(img, 0, 0);
	return x.getImageData(0, 0, c.width, c.height).data.filter((_, i) => i % 4 === 3 && _ < 255).length;
});
assert.equal(saved_transparency, 0, "the saved file has no transparent pixels");
await page.waitForTimeout(500);
assert.equal((await audit()).painting, painted, "the canvas is unchanged by saving");

// The paint bucket floods the blank area: the AI "finishes" the painting
await select_tool(page, "Fill With Color");
const c = await canvas_box(page);
await page.mouse.click(c.x + 30, c.y + 30);
await page.waitForTimeout(300);
result = await audit();
assert.equal(result.wrong, 0);
assert.ok(result.painting > 400000, "most of the painting is revealed");
await dismiss();

// Turning it off: blank areas become white and the colors come back
await click_menu_item(page, "AI Mode");
await page.waitForTimeout(300);
assert.equal(await page.evaluate(() => document.body.classList.contains("ai-mode")), false);
assert.equal(await page.evaluate(() => selected_colors.foreground instanceof CanvasPattern), false, "colors restored");
assert.equal((await audit()).blank, 0, "flattened onto white");

// Opening another picture during AI Mode ends it right away
await click_menu_item(page, "AI Mode");
await page.waitForTimeout(800);
await page.evaluate(() => { for (const button of document.querySelectorAll(".window button")) { if (button.textContent === "No" && button.offsetParent) { button.click(); } } });
await page.waitForFunction(() => document.body.classList.contains("ai-mode"), null, { timeout: 10000 });
await page.evaluate(async () => {
	const canvas = document.createElement("canvas");
	canvas.width = 200;
	canvas.height = 150;
	canvas.getContext("2d").fillRect(0, 0, 200, 150);
	const blob = await new Promise((resolve) => canvas.toBlob(resolve));
	window.open_from_file(new File([blob], "black.png", { type: "image/png" }));
});
await page.waitForTimeout(800);
await page.evaluate(() => { for (const button of document.querySelectorAll(".window button")) { if (button.textContent === "No" && button.offsetParent) { button.click(); } } });
await page.waitForFunction(() => main_canvas.width === 200, null, { timeout: 10000 });
assert.equal(await page.evaluate(() => document.body.classList.contains("ai-mode")), false, "AI Mode ended");
assert.equal(await page.evaluate(() => selected_colors.foreground instanceof CanvasPattern), false, "no AI ink on the opened picture");

assert.ok(not_found.every((path) => /^\/images\/ai-\d+\.jpg$/.test(path)), `only painting probes 404: ${not_found.join(", ")}`);
const expected_404s = errors.filter((error) => /status of 404/.test(error));
assert.ok(expected_404s.length <= not_found.length);
errors.splice(0, errors.length, ...errors.filter((error) => !/status of 404/.test(error)));
await close();
console.log("ai-mode: ok");
