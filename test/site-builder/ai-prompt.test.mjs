// AI > Prompt... (src/ai-prompt.js): a prompt box that "generates" whatever you describe, which is always one of
// AI Mode's paintings (images/ai-1.jpg), after a fake denoising preview. One undoable step; fills the selection if there is one.
// Captions react to the prompt; asking for a paperclip gets the assistant; with no paintings it draws the prompt as text.
import { assert, canvas_box, click_menu_item, open_paint, select_tool } from "./helpers.mjs";

const SAMPLE = 997; // a pixel to compare: (x * 4) of every 997th pixel is enough to tell pictures apart

/** Opens Paint, fills the canvas with a test pattern, and opens the Prompt box. */
async function setup({ no_paintings = false } = {}) {
	const paint = await open_paint();
	const { page } = paint;
	// A stand-in for images/clippy.jpg, so the test doesn't depend on that picture
	await page.route("**/images/clippy.jpg", (route) => route.fulfill({
		contentType: "image/svg+xml",
		body: `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="100"><rect width="60" height="100" fill="#0f0"/></svg>`,
	}));
	// Only painting 1 (or none), whatever else is in images/, so the result is predictable
	await page.route(/\/images\/ai-(\d+)\.(jpg|png|webp)$/, (route, request) => {
		const [, n, extension] = /ai-(\d+)\.(\w+)$/.exec(new URL(request.url()).pathname);
		return !no_paintings && n === "1" && extension === "jpg" ? route.continue() : route.fulfill({ status: 404, body: "" });
	});
	await page.evaluate(async () => {
		const { undoable } = await import("./src/functions.js");
		undoable({ name: "Test picture" }, () => {
			main_ctx.fillStyle = "#3366cc";
			main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);
		});
	});
	await click_menu_item(page, "Prompt...");
	await page.waitForSelector(".ai-prompt-window textarea", { timeout: 5000 });
	return paint;
}
const picture = (page) => page.evaluate((step) => Array.from(main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data).filter((_, i) => i % (step * 4) < 4), SAMPLE);
const box_status = (page) => page.evaluate(() => document.querySelector(".ai-prompt-status").textContent);
/** Types a prompt, presses Enter, and waits for the result. */
async function generate(page, prompt) {
	await page.fill(".ai-prompt-window textarea", prompt);
	await page.press(".ai-prompt-window textarea", "Enter");
	await page.waitForFunction(() => /Denoising/.test(document.querySelector(".ai-prompt-status").textContent), null, { timeout: 5000 });
	await page.waitForFunction(() => !/Denoising|Done!/.test(document.querySelector(".ai-prompt-status").textContent), null, { timeout: 10000 });
	await page.waitForTimeout(200);
}
/** What draw_generated() makes of an image, at the canvas size (the expected result). */
const expected = (page, url, prompt = "") => page.evaluate(async ([url, prompt, step]) => {
	const { draw_generated } = await import("./src/ai-prompt.js");
	let img = null;
	if (url) {
		img = new Image();
		img.src = url;
		await img.decode();
	}
	const canvas = document.createElement("canvas");
	canvas.width = main_canvas.width;
	canvas.height = main_canvas.height;
	draw_generated(canvas.getContext("2d"), img, prompt);
	return Array.from(canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data).filter((_, i) => i % (step * 4) < 4);
}, [url, prompt, SAMPLE]);

{
	const { page, close, errors } = await setup();
	const original = await picture(page);

	// An empty prompt is refused
	await page.click(".ai-prompt-window .ai-prompt-generate");
	await page.waitForTimeout(200);
	assert.match(await box_status(page), /describe the image/);
	assert.deepEqual(await picture(page), original);

	// Whatever you ask for, you get the painting, with a caption about your prompt
	await generate(page, "a lighthouse at sunset, highly detailed");
	assert.deepEqual(await picture(page), await expected(page, "images/ai-1.jpg"), "the painting fills the canvas");
	assert.match(await box_status(page), /Adding "highly detailed" improved the result by 0%/);
	assert.match(await page.evaluate(() => document.querySelector(".status-text").textContent), /improved the result by 0%/);
	assert.ok(await page.evaluate(() => document.querySelector(".ai-prompt-window").offsetParent !== null), "the box stays open");

	// One undo brings the picture back
	await page.evaluate(() => document.activeElement.blur()); // in the prompt, Ctrl+Z undoes typing
	await page.keyboard.press("Control+z");
	await page.waitForTimeout(300);
	assert.deepEqual(await picture(page), original, "undo restores");

	// Paperclips get the assistant
	await generate(page, "a friendly paperclip");
	assert.deepEqual(await picture(page), await expected(page, "images/clippy.jpg"));
	assert.match(await box_status(page), /It looks like you're trying to generate an image/);
	await page.evaluate(() => document.activeElement.blur()); // in the prompt, Ctrl+Z undoes typing
	await page.keyboard.press("Control+z");
	await page.waitForTimeout(300);

	// With a selection, only the selection changes
	await page.click(".ai-prompt-window .window-close-button");
	await select_tool(page, "Select");
	const c = await canvas_box(page);
	await page.mouse.move(c.x + 50, c.y + 60);
	await page.mouse.down();
	await page.mouse.move(c.x + 250, c.y + 180, { steps: 5 });
	await page.mouse.up();
	await page.waitForTimeout(200);
	const box = await page.evaluate(() => ({ x: selection.x, y: selection.y, width: selection.width, height: selection.height }));
	await click_menu_item(page, "Prompt...");
	await page.waitForSelector(".ai-prompt-window textarea", { timeout: 5000 });
	await generate(page, "a bowl of fruit in the style of Picasso");
	assert.match(await box_status(page), /Style noted, and ignored/);
	await page.evaluate(async () => { (await import("./src/functions.js")).deselect(); });
	await page.waitForTimeout(200);
	const counts = await page.evaluate((box) => {
		const d = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data;
		let outside_changed = 0, inside_changed = 0;
		for (let y = 0; y < main_canvas.height; y++) {
			for (let x = 0; x < main_canvas.width; x++) {
				const i = (y * main_canvas.width + x) * 4;
				const blue = d[i] === 0x33 && d[i + 1] === 0x66 && d[i + 2] === 0xcc;
				const inside = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
				if (inside && !blue) { inside_changed++; }
				if (!inside && !blue) { outside_changed++; }
			}
		}
		return { outside_changed, inside_changed };
	}, box);
	assert.equal(counts.outside_changed, 0, "outside the selection is untouched");
	assert.ok(counts.inside_changed > box.width * box.height * 0.9, "the selection got the painting");

	errors.splice(0, errors.length, ...errors.filter((error) => !/status of 404/.test(error))); // looking for images/ai-2.jpg and so on
	await close();
}

// With no paintings, it draws exactly what you asked for: the words
{
	const { page, close, errors } = await setup({ no_paintings: true });
	await generate(page, "a cat");
	assert.match(await box_status(page), /We drew exactly what you asked for/);
	assert.deepEqual(await picture(page), await expected(page, null, "a cat"));
	errors.splice(0, errors.length, ...errors.filter((error) => !/status of 404/.test(error))); // the painting probe
	await close();
}

console.log("ai-prompt: ok");
