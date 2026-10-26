// Extras menu items restored from upstream JS Paint: Draw Randomly, Head Tracker, Dwell Clicker, Quick Undo Button,
// and Vertical Color Box (now Color Box › Right). Each toggles (with a check mark), and does its thing.
import { assert, click_menu_item, open_paint } from "./helpers.mjs";

const { page, close } = await open_paint();
const checked = (label) => page.evaluate((label) => document.querySelector(`[role=menuitemcheckbox][aria-label="${label}"]`).getAttribute("aria-checked") === "true", label);
const open_extras = async () => {
	// opening the menu refreshes the check marks
	await page.evaluate(() => [...document.querySelectorAll(".menu-button")].find((b) => b.textContent.trim() === "Extras").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
	await page.waitForTimeout(200);
	await page.keyboard.press("Escape");
};
const ink = () => page.evaluate(() => main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data.reduce((sum, v, i) => sum + (i % 4 === 3 ? 0 : 255 - v), 0));
const body_has = (name) => page.evaluate((name) => document.body.classList.contains(name), name);

// Draw Randomly: draws on its own until turned off
assert.equal(await ink(), 0, "blank to start");
await page.evaluate(() => { window.drawRandomlySeed = 1998; }); // the same "random" drawing every run
await click_menu_item(page, "Draw Randomly");
await page.waitForFunction(() => main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data.some((v, i) => i % 4 !== 3 && v < 255), null, { timeout: 20000 });
await open_extras();
assert.equal(await checked("Draw Randomly"), true);
await click_menu_item(page, "Draw Randomly");
await page.waitForTimeout(500);
const after_stop = await ink();
await page.waitForTimeout(1500);
assert.equal(await ink(), after_stop, "stopped drawing");
await open_extras();
assert.equal(await checked("Draw Randomly"), false);

// Color Box › Right (was the Vertical Color Box checkbox): the colors move to the right side, and the Undo/Redo pair with them
await click_menu_item(page, "Right");
await page.waitForTimeout(500);
assert.equal(await body_has("vertical-color-box-mode"), true);
assert.equal(await page.evaluate(() => document.querySelector(".colors-component").closest(".component-area").classList.contains("right")), true);
assert.equal(await page.evaluate(() => document.querySelector(".quick-buttons").parentElement.classList.contains("right")), true, "undo/redo under the colors");
const overlaps_status_bar = await page.evaluate(() => {
	const buttons = document.querySelector(".quick-buttons").getBoundingClientRect();
	const status = document.querySelector(".status-area").getBoundingClientRect();
	return buttons.bottom > status.top && buttons.top < status.bottom;
});
assert.equal(overlaps_status_bar, false);
await click_menu_item(page, "Bottom");
await page.waitForTimeout(500);
assert.equal(await body_has("vertical-color-box-mode"), false);
assert.equal(await page.evaluate(() => document.querySelector(".quick-buttons").parentElement.classList.contains("bottom")), true, "back in the bottom bar");

// Quick Undo Button: a big floating Undo button that undoes
await page.evaluate(async () => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Test" }, () => { main_ctx.fillStyle = "#f00"; main_ctx.fillRect(0, 0, 50, 50); });
});
await click_menu_item(page, "Quick Undo Button");
await page.waitForTimeout(500);
assert.equal(await body_has("easy-undo-mode"), true);
await page.waitForSelector(".floating-undo-button", { state: "visible", timeout: 3000 });
const red_before = await page.evaluate(() => main_ctx.getImageData(10, 10, 1, 1).data[1]);
assert.equal(red_before, 0, "the red square");
await page.click(".floating-undo-button");
await page.waitForTimeout(300);
assert.notEqual(await page.evaluate(() => main_ctx.getImageData(10, 10, 1, 1).data[1]), 0, "undone");
await click_menu_item(page, "Quick Undo Button");
await page.waitForTimeout(500);
assert.equal(await body_has("easy-undo-mode"), false);

// Dwell Clicker: on and off
await click_menu_item(page, "Dwell Clicker");
await page.waitForTimeout(800);
assert.equal(await body_has("dwell-clicker-mode"), true);
await open_extras();
assert.equal(await checked("Dwell Clicker"), true);
await click_menu_item(page, "Dwell Clicker");
await page.waitForTimeout(500);
assert.equal(await body_has("dwell-clicker-mode"), false);

// Head Tracker: opens the Tracky Mouse window (and implies Dwell Clicker); off closes it
await click_menu_item(page, "Head Tracker");
await page.waitForSelector(".tracky-mouse-ui", { timeout: 20000 });
assert.equal(await body_has("head-tracker-mode"), true);
assert.equal(await body_has("dwell-clicker-mode"), true);
await page.waitForTimeout(8000); // let its face tracker finish loading (turning it off mid-load cuts off the worker's script loading)
await click_menu_item(page, "Head Tracker");
await page.waitForTimeout(1000);
assert.equal(await body_has("head-tracker-mode"), false);
assert.equal(await page.$(".tracky-mouse-ui"), null);

await close();
console.log("extras-restored: ok");
