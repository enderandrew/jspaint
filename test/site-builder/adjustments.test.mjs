// The Adjustments menu (src/adjustments.js): dialogs preview live on the canvas, Cancel puts it back, OK applies the
// same result as one undoable step; one-click filters; working on a selection only; and the parody entries.
import { assert, canvas_box, click_menu_item, open_paint, select_tool } from "./helpers.mjs";

const { page, close } = await open_paint();

// A colorful test picture
await page.evaluate(async () => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Test picture" }, () => {
		const data = main_ctx.createImageData(main_canvas.width, main_canvas.height);
		for (let y = 0; y < data.height; y++) {
			for (let x = 0; x < data.width; x++) {
				data.data.set([(x * 255 / data.width) | 0, (y * 255 / data.height) | 0, ((x + y) * 3) % 256, 255], (y * data.width + x) * 4);
			}
		}
		main_ctx.putImageData(data, 0, 0);
		main_ctx.fillStyle = "#000";
		main_ctx.fillRect(300, 200, 120, 90);
	});
});
const picture = () => page.evaluate(() => Array.from(main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data).join());
const original = await picture();
/** What an exported adjustment makes of the original picture. */
const expected = (name, params) => page.evaluate(async ([name, params]) => {
	const adjustments = await import("./src/adjustments.js");
	const canvas = document.createElement("canvas");
	canvas.width = main_canvas.width;
	canvas.height = main_canvas.height;
	const ctx = canvas.getContext("2d");
	ctx.drawImage(window.__original_canvas, 0, 0);
	return Array.from(adjustments[name](ctx.getImageData(0, 0, canvas.width, canvas.height), params).data).join();
}, [name, params]);
await page.evaluate(() => {
	window.__original_canvas = document.createElement("canvas");
	window.__original_canvas.width = main_canvas.width;
	window.__original_canvas.height = main_canvas.height;
	window.__original_canvas.getContext("2d").drawImage(main_canvas, 0, 0);
});
const button = (label) => page.evaluate((label) => [...document.querySelectorAll(".window button")].filter((b) => b.offsetParent && b.textContent === label).pop().click(), label);
const set_slider = (id, value) => page.evaluate(([id, value]) => {
	const input = document.querySelector(`.adjustment-slider-${id}`);
	if (input.type === "checkbox") { input.checked = Boolean(value); } else { input.value = value; }
	input.dispatchEvent(new Event(input.type === "checkbox" ? "change" : "input"));
}, [id, value]);
const undo = async () => {
	await page.evaluate(() => document.activeElement?.blur());
	await page.keyboard.press("Control+z");
	await page.waitForTimeout(300);
};
const status = () => page.evaluate(() => document.querySelector(".status-text").textContent);

// A dialog: live preview, Cancel restores
await click_menu_item(page, "Brightness/Contrast...");
await page.waitForSelector(".adjustment-window");
await set_slider("brightness", 40);
await set_slider("contrast", 30);
await page.waitForTimeout(200);
assert.equal(await picture(), await expected("brightness_contrast", { brightness: 40, contrast: 30 }), "previewed on the canvas");
await button("Cancel");
await page.waitForTimeout(200);
assert.equal(await picture(), original, "canceled: back to the original");

// OK applies the same thing, as one undoable step
await click_menu_item(page, "Brightness/Contrast...");
await set_slider("brightness", 40);
await set_slider("contrast", 30);
await button("OK");
await page.waitForTimeout(200);
assert.equal(await picture(), await expected("brightness_contrast", { brightness: 40, contrast: 30 }));
await undo();
assert.equal(await picture(), original, "undo");

// More dialogs
for (const [item, name, params] of [
	["Hue/Saturation...", "hue_saturation", { hue: 90, saturation: -40, lightness: 10 }],
	["Posterize...", "posterize", { levels: 3 }],
	["Threshold...", "threshold", { level: 100 }],
	["Blur...", "blur", { radius: 4 }],
	["Sharpen...", "sharpen", { amount: 150, radius: 2 }],
	["Add Noise...", "add_noise", { amount: 30, color: 1 }],
]) {
	await click_menu_item(page, item);
	await page.waitForSelector(".adjustment-window");
	for (const [id, value] of Object.entries(params)) { await set_slider(id, value); }
	await button("OK");
	await page.waitForTimeout(200);
	assert.equal(await picture(), await expected(name, params), item);
	await undo();
	assert.equal(await picture(), original, `${item}: undo`);
}

// Posterize and Threshold limit the colors
await click_menu_item(page, "Threshold...");
await button("OK");
await page.waitForTimeout(200);
assert.ok(await page.evaluate(() => main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data.every((v, i) => i % 4 === 3 || v === 0 || v === 255)), "only black and white");
await undo();

// One-click filters
for (const [item, name] of [["Auto Contrast", "auto_contrast"], ["Grayscale", "grayscale"], ["Sepia", "sepia"], ["Emboss", "emboss"], ["Find Edges", "find_edges"]]) {
	await click_menu_item(page, item);
	await page.waitForTimeout(300);
	assert.equal(await picture(), await expected(name, {}), item);
	await undo();
	assert.equal(await picture(), original, `${item}: undo`);
}

// On a selection, only the selection changes
await select_tool(page, "Select");
const c = await canvas_box(page);
await page.mouse.move(c.x + 50, c.y + 50);
await page.mouse.down();
await page.mouse.move(c.x + 250, c.y + 200, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(200);
const box = await page.evaluate(() => ({ x: selection.x, y: selection.y, width: selection.width, height: selection.height }));
await click_menu_item(page, "Grayscale");
await page.waitForTimeout(300);
await page.evaluate(async () => { (await import("./src/functions.js")).deselect(); });
await page.waitForTimeout(200);
const counts = await page.evaluate((box) => {
	const now = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data;
	const before = window.__original_canvas.getContext("2d").getImageData(0, 0, main_canvas.width, main_canvas.height).data;
	let outside_changed = 0, inside_colored = 0;
	for (let y = 0; y < main_canvas.height; y++) {
		for (let x = 0; x < main_canvas.width; x++) {
			const i = (y * main_canvas.width + x) * 4;
			const inside = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
			if (inside && !(now[i] === now[i + 1] && now[i + 1] === now[i + 2])) { inside_colored++; }
			if (!inside && (now[i] !== before[i] || now[i + 1] !== before[i + 1] || now[i + 2] !== before[i + 2])) { outside_changed++; }
		}
	}
	return { outside_changed, inside_colored };
}, box);
assert.deepEqual(counts, { outside_changed: 0, inside_colored: 0 }, "only the selection turned gray");
await undo();
await page.evaluate(async () => { (await import("./src/functions.js")).deselect(); });
await page.waitForTimeout(200);

// Parody: Make It Pop has opinions
await click_menu_item(page, "Make It Pop...");
await page.waitForSelector(".adjustment-window");
await set_slider("pop", 0);
assert.match(await page.evaluate(() => document.querySelector(".adjustment-window").textContent), /Not popping/);
await set_slider("pop", 100);
assert.match(await page.evaluate(() => document.querySelector(".adjustment-window").textContent), /Exploded/);
await button("OK");
await page.waitForTimeout(300);
assert.notEqual(await picture(), original);
assert.match(await status(), /It popped/);
await undo();

// Deep Fry (re-encodes as JPEG, so it's asynchronous)
await click_menu_item(page, "Deep Fry");
await page.waitForFunction(() => /Deep fried/.test(document.querySelector(".status-text").textContent), null, { timeout: 10000 });
assert.notEqual(await picture(), original);
assert.ok(await page.evaluate(() => main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data.every((v, i) => i % 4 !== 3 || v === 255)), "still opaque");
await undo();
assert.equal(await picture(), original, "Deep Fry: undo");

// 1998 Film Filter: with an orange date stamp in the corner
await click_menu_item(page, "1998 Film Filter");
await page.waitForTimeout(300);
const orange = await page.evaluate(() => {
	const w = 200, h = 80;
	const d = main_ctx.getImageData(main_canvas.width - w, main_canvas.height - h, w, h).data;
	let count = 0;
	for (let i = 0; i < d.length; i += 4) { if (d[i] > 230 && d[i + 1] > 120 && d[i + 1] < 200 && d[i + 2] < 120) { count++; } }
	return count;
});
assert.ok(orange > 50, `date stamp (${orange} orange pixels)`);
await undo();

// Add Lens Flare: a bright spot up and to the right
await click_menu_item(page, "Add Lens Flare");
await page.waitForTimeout(300);
assert.ok(await page.evaluate(() => {
	const d = main_ctx.getImageData(Math.round(main_canvas.width * 0.78), Math.round(main_canvas.height * 0.22), 1, 1).data;
	return d[0] > 245 && d[1] > 245 && d[2] > 240;
}), "lens flare");
await undo();
assert.equal(await picture(), original);

// Fix Everything changes nothing, carefully
await click_menu_item(page, "Fix Everything");
await page.waitForFunction(() => /found 0 problems/.test(document.body.textContent), null, { timeout: 6000 });
assert.equal(await picture(), original);
await button("OK");

await close();
console.log("adjustments: ok");
