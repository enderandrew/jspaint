// View › Reference Image (src/reference-image.js; a port of 1j01/jspaint #372–#374): a faded picture over the
// canvas to trace over. Drawing goes through it onto the canvas; it's never part of the picture or its history;
// its opacity can change; it hides and shows, moves by its grip, resizes (proportionally with Shift), stays
// through a new document, sits under page elements, and goes away when removed.
import { assert, click_menu_item, open_paint, select_tool } from "./helpers.mjs";

const { page, close } = await open_paint();
const ref = () => page.evaluate(async () => {
	const image = (await import("./src/reference-image.js")).get_reference_image();
	if (!image) { return null; }
	return { x: image.x, y: image.y, width: image.width, height: image.height, opacity: image.opacity, visible: image.visible, hidden: image.$el.hasClass("hidden"), css_opacity: image.canvas.style.opacity };
});
const menu_enabled = async (label) => {
	await page.evaluate(() => [...document.querySelectorAll(".menu-button")].find((b) => b.textContent.trim() === "View").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
	await page.waitForTimeout(100);
	await click_menu_item(page, "Reference Image");
	await page.waitForTimeout(200);
	const enabled = await page.evaluate((label) => document.querySelector(`[role=menuitem][aria-label="${label}"]`)?.getAttribute("aria-disabled") !== "true", label);
	for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); }
	return enabled;
};
const canvas_sum = () => page.evaluate(() => {
	const d = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data;
	let h = 0;
	for (let i = 0; i < d.length; i += 5) { h = (h * 31 + d[i]) | 0; }
	return h;
});

// Nothing yet: only Load is on offer
assert.equal(await menu_enabled("Load Reference Image..."), true);
assert.equal(await menu_enabled("Remove Reference Image"), false);
assert.equal(await menu_enabled("Reference Image Opacity..."), false);

// Load a picture (a 200×100 green one, as a PNG file)
const before_sum = await canvas_sum();
const history_before = await page.evaluate(() => current_history_node.name);
await page.evaluate(async () => {
	const canvas = document.createElement("canvas");
	canvas.width = 200;
	canvas.height = 100;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#0f0";
	ctx.fillRect(0, 0, 200, 100);
	const blob = await new Promise((resolve) => { canvas.toBlob(resolve, "image/png"); });
	await (await import("./src/reference-image.js")).open_reference_image_file(new File([blob], "trace-me.png", { type: "image/png" }));
});
let r = await ref();
assert.deepEqual({ x: r.x, y: r.y, width: r.width, height: r.height, opacity: r.opacity, visible: r.visible }, { x: 0, y: 0, width: 200, height: 100, opacity: 0.5, visible: true });
assert.equal(r.css_opacity, "0.5", "faded");
assert.equal(await canvas_sum(), before_sum, "the picture itself is untouched");
assert.equal(await page.evaluate(() => current_history_node.name), history_before, "and it's not an undo step");
assert.equal(await menu_enabled("Remove Reference Image"), true);

// It sits over the bitmap and under page elements and the selection
const layers = await page.evaluate(() => {
	const el = document.querySelector(".reference-image");
	const canvas = document.querySelector(".main-canvas");
	return {
		z: getComputedStyle(el).zIndex,
		canvas_z: getComputedStyle(canvas).zIndex,
		after_canvas: Boolean(canvas.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
		helper_z: getComputedStyle(document.querySelector(".helper-layer") || document.body).zIndex,
	};
});
assert.deepEqual([layers.z, layers.canvas_z, layers.after_canvas], ["2", "2", true]);

// Drawing goes through it onto the canvas
await select_tool(page, "Pencil");
const box = await page.evaluate(() => { const rect = document.querySelector(".main-canvas").getBoundingClientRect(); return { x: rect.left, y: rect.top }; });
await page.mouse.move(box.x + 60, box.y + 50);
await page.mouse.down();
await page.mouse.move(box.x + 120, box.y + 50, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(200);
const drawn = await page.evaluate(() => [...main_ctx.getImageData(90, 50, 1, 1).data]);
assert.notDeepEqual(drawn, [255, 255, 255, 255], "the pencil drew on the canvas under it");

// Opacity
await page.evaluate(async () => { (await import("./src/reference-image.js")).show_reference_image_opacity_window(); });
await page.waitForSelector("#reference-opacity-slider");
await page.evaluate(() => {
	const slider = document.querySelector("#reference-opacity-slider");
	slider.value = "30";
	slider.dispatchEvent(new Event("input", { bubbles: true }));
});
r = await ref();
assert.equal(r.opacity, 0.3);
assert.equal(r.css_opacity, "0.3");
assert.equal(await page.evaluate(() => document.querySelector(".reference-opacity-value").textContent), "30%");
await page.evaluate(() => [...document.querySelectorAll(".window button")].filter((b) => b.offsetParent && b.textContent.trim() === "OK").pop().click());

// Hide and show (View › Reference Image › Show Reference Image)
await page.evaluate(() => [...document.querySelectorAll(".menu-button")].find((b) => b.textContent.trim() === "View").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
await click_menu_item(page, "Reference Image");
await click_menu_item(page, "Show Reference Image");
for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); } // (a checkbox item leaves the menu open)
r = await ref();
assert.equal(r.visible, false);
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".reference-image")).display), "none");
await page.evaluate(async () => { (await import("./src/reference-image.js")).toggle_reference_image(); });
assert.equal((await ref()).visible, true);

// Move it by its grip
const grip = await page.evaluate(() => { const rect = document.querySelector(".reference-image-grip").getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; });
await page.mouse.move(grip.x, grip.y);
await page.mouse.down();
await page.mouse.move(grip.x + 40, grip.y + 30, { steps: 5 });
await page.mouse.up();
r = await ref();
assert.deepEqual([r.x, r.y], [40, 30], "moved by the grip");
assert.deepEqual(await page.evaluate(() => [...main_ctx.getImageData(90, 50, 1, 1).data]), drawn, "without drawing");
assert.deepEqual(await page.evaluate(() => [...main_ctx.getImageData(70, 70, 1, 1).data]), [255, 255, 255, 255], "(nothing drawn along the drag)");

// Resize it from its bottom right corner, with Shift: it keeps its proportions (2:1)
const corner = await page.evaluate(() => {
	const regions = [...document.querySelectorAll(".reference-image .grab-region")].map((el) => el.getBoundingClientRect());
	const rect = regions.sort((a, b) => (b.right + b.bottom) - (a.right + a.bottom))[0];
	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
});
await page.keyboard.down("Shift");
await page.mouse.move(corner.x, corner.y);
await page.mouse.down();
await page.mouse.move(corner.x + 100, corner.y + 10, { steps: 6 });
await page.mouse.up();
await page.keyboard.up("Shift");
r = await ref();
assert.ok(r.width > 250, `bigger: ${r.width}×${r.height}`);
assert.ok(Math.abs(r.width / r.height - 2) < 0.05, `in proportion: ${r.width}×${r.height}`);
// (without Shift it stretches freely)
const corner2 = await page.evaluate(() => {
	const regions = [...document.querySelectorAll(".reference-image .grab-region")].map((el) => el.getBoundingClientRect());
	const rect = regions.sort((a, b) => (b.right + b.bottom) - (a.right + a.bottom))[0];
	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
});
await page.mouse.move(corner2.x, corner2.y);
await page.mouse.down();
await page.mouse.move(corner2.x, corner2.y + 80, { steps: 6 });
await page.mouse.up();
const stretched = await ref();
assert.equal(stretched.width, r.width);
assert.ok(stretched.height > r.height + 50, "taller only");

// A new document keeps it (it's a tool for drawing, not part of the picture)
await page.evaluate(async () => { (await import("./src/functions.js")).reset_canvas_and_history(); });
assert.ok(await ref(), "still there after a new document");

// Loading another replaces it, keeping the opacity
await page.evaluate(async () => {
	const canvas = document.createElement("canvas");
	canvas.width = 50;
	canvas.height = 50;
	await (await import("./src/reference-image.js")).open_reference_image_file(await new Promise((resolve) => { canvas.toBlob((blob) => resolve(new File([blob], "b.png", { type: "image/png" })), "image/png"); }));
});
r = await ref();
assert.deepEqual([r.width, r.height, r.opacity], [50, 50, 0.3]);
assert.equal(await page.evaluate(() => document.querySelectorAll(".reference-image").length), 1, "one at a time");

// Remove
await page.evaluate(() => [...document.querySelectorAll(".menu-button")].find((b) => b.textContent.trim() === "View").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
await click_menu_item(page, "Reference Image");
await click_menu_item(page, "Remove Reference Image");
assert.equal(await ref(), null);
assert.equal(await page.evaluate(() => document.querySelectorAll(".reference-image, .reference-image-grip").length), 0, "nothing left behind");
assert.equal(await menu_enabled("Remove Reference Image"), false);

await close();
console.log("reference-image: ok");
