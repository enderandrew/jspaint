// Extras › Color Box: the color box at the bottom (as in MS Paint), on the right (the old Vertical Color Box checkbox),
// or at the top (as in Windows Vista's Paint); and the Magnifier's zoom slider (tool-options.js), from 12.5% to
// 1000%, in place of four fixed zooms.
/* global magnification */
import { assert, click_menu_item, open_paint, select_tool } from "./helpers.mjs";

const { page, close } = await open_paint();

// --- Color box position ---
const color_box_area = () => page.evaluate(() => {
	const area = document.querySelector(".colors-component").closest(".component-area");
	return area ? [...area.classList].find((c) => ["top", "bottom", "left", "right"].includes(c)) : "floating";
});
const pick = async (label) => {
	await page.evaluate(() => [...document.querySelectorAll(".menu-button")].find((b) => b.textContent.trim() === "Extras").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
	await page.waitForTimeout(100);
	await click_menu_item(page, "Color Box");
	await page.waitForTimeout(200);
	await click_menu_item(page, label);
	for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); }
	await page.waitForTimeout(400);
};
const checked = () => page.evaluate(() => [...document.querySelectorAll("[role=menuitemradio]")].filter((el) => el.getAttribute("aria-checked") === "true").map((el) => el.getAttribute("aria-label")));

assert.equal(await color_box_area(), "bottom", "at the bottom to start with");
await pick("Top");
assert.equal(await color_box_area(), "top");
assert.match(await page.evaluate(() => location.hash), /color-box-top/);
assert.ok(await page.evaluate(() => document.querySelector(".colors-component").getBoundingClientRect().top < document.querySelector(".main-canvas").getBoundingClientRect().top), "above the canvas");
assert.ok((await checked()).includes("Top"));
await pick("Right");
assert.equal(await color_box_area(), "right");
assert.ok(await page.evaluate(() => document.body.classList.contains("vertical-color-box-mode") && !document.body.classList.contains("color-box-top")), "one place at a time");
assert.equal(await page.evaluate(() => document.querySelectorAll(".colors-component").length), 1, "one color box");
await pick("Bottom");
assert.equal(await color_box_area(), "bottom");
assert.doesNotMatch(await page.evaluate(() => location.hash), /color-box-top|vertical-color-box-mode/);
// The colors still work wherever it is
await pick("Top");
await page.evaluate(() => {
	const buttons = [...document.querySelectorAll(".colors-component .color-button")];
	window.__pick = String($(buttons[5]).data("swatch"));
	buttons[5].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
});
assert.equal(await page.evaluate(() => String(selected_colors.foreground)), await page.evaluate(() => window.__pick), "picking a color works there");
// An old address with #vertical-color-box-mode still puts it on the right
await page.evaluate(() => { location.hash = "vertical-color-box-mode"; });
await page.waitForTimeout(400);
assert.equal(await color_box_area(), "right");
await page.evaluate(() => { location.hash = ""; });
await page.waitForTimeout(400);
assert.equal(await color_box_area(), "bottom");

// --- Zoom slider ---
await select_tool(page, "Magnifier");
const slider = () => page.evaluate(() => {
	const el = document.querySelector(".tool-options .zoom-slider");
	return el && { label: el.querySelector(".zoom-slider-label").textContent, now: Number(el.getAttribute("aria-valuenow")), ticks: el.querySelectorAll(".zoom-slider-tick").length, thumb_top: el.querySelector(".zoom-slider-thumb").getBoundingClientRect().top };
});
let s = await slider();
assert.deepEqual([s.label, s.now, s.ticks], ["100%", 100, 10], "a slider at 100%, with ten steps");
// Click near the top of the track: the most zoomed in
const track = await page.evaluate(() => { const r = document.querySelector(".zoom-slider-track").getBoundingClientRect(); return { x: r.left + r.width / 2, top: r.top, bottom: r.bottom }; });
await page.mouse.click(track.x, track.top + 1);
assert.equal(await page.evaluate(() => magnification), 10);
assert.equal((await slider()).label, "1000%");
// Drag down to the bottom: 12.5%
await page.mouse.move(track.x, track.top + 1);
await page.mouse.down();
await page.mouse.move(track.x, track.bottom + 20, { steps: 8 });
await page.mouse.up();
assert.equal(await page.evaluate(() => magnification), 0.125);
s = await slider();
assert.equal(s.label, "12.5%");
assert.equal(await page.evaluate(() => document.querySelector(".main-canvas").getBoundingClientRect().width), await page.evaluate(() => main_canvas.width * 0.125), "the canvas shows at 12.5%");
// Keys: up a step at a time; Home and End
await page.focus(".zoom-slider");
await page.keyboard.press("ArrowUp");
assert.equal(await page.evaluate(() => magnification), 0.25);
await page.keyboard.press("ArrowUp");
await page.keyboard.press("ArrowUp");
assert.equal(await page.evaluate(() => magnification), 1);
await page.keyboard.press("ArrowUp");
assert.equal(await page.evaluate(() => magnification), 2);
await page.keyboard.press("End");
assert.equal(await page.evaluate(() => magnification), 10);
await page.keyboard.press("Home");
assert.equal(await page.evaluate(() => magnification), 0.125);
// The wheel
await page.mouse.move(track.x, (track.top + track.bottom) / 2);
await page.mouse.wheel(0, -100);
await page.waitForTimeout(100);
assert.equal(await page.evaluate(() => magnification), 0.25, "scrolling up zooms in");
// It follows a zoom from elsewhere, between steps too (View › Zoom › Custom: 150%)
await page.evaluate(async () => { (await import("./src/functions.js")).set_magnification(1.5); });
await page.waitForTimeout(100);
s = await slider();
assert.equal(s.label, "150%");
const t100 = await page.evaluate(async () => { (await import("./src/functions.js")).set_magnification(1); await new Promise((r) => setTimeout(r, 50)); return document.querySelector(".zoom-slider-thumb").getBoundingClientRect().top; });
const t200 = await page.evaluate(async () => { (await import("./src/functions.js")).set_magnification(2); await new Promise((r) => setTimeout(r, 50)); return document.querySelector(".zoom-slider-thumb").getBoundingClientRect().top; });
assert.ok(s.thumb_top < t100 && s.thumb_top > t200, "150% sits between 100% and 200%");
// From 150%, a step up goes to 200% and a step down to 100%
await page.evaluate(async () => { (await import("./src/functions.js")).set_magnification(1.5); });
await page.focus(".zoom-slider");
await page.keyboard.press("ArrowUp");
assert.equal(await page.evaluate(() => magnification), 2);
await page.evaluate(async () => { (await import("./src/functions.js")).set_magnification(1.5); });
await page.keyboard.press("ArrowDown");
assert.equal(await page.evaluate(() => magnification), 1);
// The Magnifier itself still toggles between 100% and the last zoom in (not a zoom out)
await page.keyboard.press("ArrowUp"); // 200%
await page.keyboard.press("Home"); // 12.5%
await page.keyboard.press("End"); // 1000%
await page.evaluate(async () => { (await import("./src/functions.js")).set_magnification(0.5); });
await page.evaluate(async () => { (await import("./src/functions.js")).set_magnification(1); });
const box = await page.evaluate(() => { const r = document.querySelector(".main-canvas").getBoundingClientRect(); return { x: r.left + 50, y: r.top + 50 }; });
await page.mouse.click(box.x, box.y);
await page.waitForTimeout(200);
assert.equal(await page.evaluate(() => magnification), 10, "the Magnifier zooms back in to 1000%, not 50%");

await close();
console.log("vista-ui: ok");
