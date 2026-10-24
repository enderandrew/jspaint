// Small features from TODO.md: Image › Crop to Selection (and Ctrl+Shift+X); Shift keeps a selection's proportions
// while resizing; the Magnifier waits for a finger to lift; the Fonts toolbar remembers where it was; the status bar
// shows where a link goes; buttons aren't text to select; and Help's Index and Search tabs, glossary popups, and
// Related Topics links.
/* global magnification */
import { assert, canvas_box, click_menu_item, open_paint, select_tool } from "./helpers.mjs";

const { page, close } = await open_paint({ init: () => { localStorage.setItem("jspaint font box position", JSON.stringify({ left: 333, top: 222 })); } });
const size = () => page.evaluate(() => `${main_canvas.width}x${main_canvas.height}`);
const visible_text = () => page.evaluate(() => [...document.querySelectorAll(".window")].filter((w) => w.offsetParent).map((w) => w.textContent).join("\n"));
const button = (label) => page.evaluate((label) => [...document.querySelectorAll(".window button")].filter((b) => b.offsetParent && b.textContent === label).pop().click(), label);
const select_rect = async (x1, y1, x2, y2) => {
	await select_tool(page, "Select");
	const c = await canvas_box(page);
	await page.mouse.move(c.x + x1, c.y + y1);
	await page.mouse.down();
	await page.mouse.move(c.x + x2, c.y + y2, { steps: 5 });
	await page.mouse.up();
	await page.waitForTimeout(200);
	return page.evaluate(() => ({ x: selection.x, y: selection.y, width: selection.width, height: selection.height }));
};

// A picture to crop: a red square at (100, 80)
await page.evaluate(async () => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Test" }, () => { main_ctx.fillStyle = "#f00"; main_ctx.fillRect(100, 80, 50, 40); });
});
const original_size = await size();

// Crop to Selection with nothing selected: a tip
await click_menu_item(page, "Crop to Selection");
await page.waitForTimeout(300);
assert.match(await visible_text(), /Select the part of the picture you want to keep/);
await button("OK");

// Crop to the selection: the picture is the selection's box, and its pixels
const box = await select_rect(100, 80, 150, 120);
await page.evaluate(async () => { (await import("./src/crop.js")).crop_to_selection(); });
await page.waitForTimeout(300);
assert.equal(await size(), `${box.width}x${box.height}`);
assert.deepEqual(await page.evaluate(() => [...main_ctx.getImageData(5, 5, 1, 1).data]), [255, 0, 0, 255], "the red square is what's left");
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press("Control+z");
await page.waitForTimeout(300);
assert.equal(await size(), original_size, "undo");

// ...and by keyboard
await select_rect(10, 10, 60, 40);
await page.keyboard.press("Control+Shift+X");
await page.waitForTimeout(300);
assert.notEqual(await size(), original_size, "Ctrl+Shift+X crops");
await page.keyboard.press("Control+z");
await page.waitForTimeout(300);

// Shift + a corner handle keeps the selection's proportions
const before = await select_rect(200, 100, 300, 150); // 2:1
const handle = await page.evaluate(() => {
	const handles = [...document.querySelectorAll(".selection .handle")].map((h) => h.getBoundingClientRect()).filter((r) => r.width);
	const se = handles.reduce((a, b) => (a.right + a.bottom > b.right + b.bottom ? a : b));
	return { x: se.left + se.width / 2, y: se.top + se.height / 2 };
});
await page.keyboard.down("Shift");
await page.mouse.move(handle.x, handle.y);
await page.mouse.down();
await page.mouse.move(handle.x + 100, handle.y + 10, { steps: 6 }); // mostly wider
await page.mouse.up();
await page.keyboard.up("Shift");
await page.waitForTimeout(300);
const after = await page.evaluate(() => ({ width: selection.width, height: selection.height }));
assert.ok(after.width > before.width + 50, `wider: ${JSON.stringify([before, after])}`);
assert.ok(Math.abs(after.width / after.height - before.width / before.height) < 0.1, `same proportions: ${JSON.stringify([before, after])}`);
await page.evaluate(async () => { (await import("./src/functions.js")).deselect(); });

// The Magnifier waits for a finger to lift (a second finger would make it a pinch)
await select_tool(page, "Magnifier");
const zoom = () => page.evaluate(() => magnification);
const start_zoom = await zoom();
const c = await canvas_box(page);
const touch = (type) => page.evaluate(([type, x, y]) => {
	document.querySelector(".main-canvas").dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: type === "pointerdown" ? 0 : -1, buttons: type === "pointerdown" ? 1 : 0 }));
}, [type, c.x + 100, c.y + 100]);
await touch("pointerdown");
await page.waitForTimeout(200);
assert.equal(await zoom(), start_zoom, "no zoom while the finger is down");
await page.evaluate(([x, y]) => { window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y })); }, [c.x + 100, c.y + 100]);
await page.waitForTimeout(300);
assert.notEqual(await zoom(), start_zoom, "zooms when it lifts");
await page.evaluate(async () => { (await import("./src/functions.js")).set_magnification(1); });

// The Fonts toolbar opens where it was left
await select_tool(page, "Text");
await page.mouse.move(c.x + 50, c.y + 300);
await page.mouse.down();
await page.mouse.move(c.x + 250, c.y + 360, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(400);
const font_box = await page.evaluate(() => {
	const w = [...document.querySelectorAll(".window")].find((el) => el.offsetParent && /Fonts/.test(el.querySelector(".window-title")?.textContent ?? ""));
	const r = w.getBoundingClientRect();
	return { left: Math.round(r.left), top: Math.round(r.top) };
});
assert.deepEqual(font_box, { left: 333, top: 222 });
await page.keyboard.press("Escape");
await select_tool(page, "Pencil");

// The status bar shows where a link goes
await page.evaluate(() => {
	const link = document.createElement("div");
	link.className = "has-link test-link";
	link.title = "https://example.com/linked";
	Object.assign(link.style, { position: "absolute", left: "60px", top: "60px", width: "50px", height: "50px", zIndex: 100 });
	document.querySelector(".canvas-area").append(link);
});
const link_box = await page.locator(".test-link").boundingBox();
await page.mouse.move(link_box.x + 25, link_box.y + 25);
await page.waitForTimeout(100);
assert.equal(await page.evaluate(() => document.querySelector(".status-text").textContent), "https://example.com/linked");
await page.mouse.move(link_box.x + 300, link_box.y + 300);
await page.waitForTimeout(100);
assert.notEqual(await page.evaluate(() => document.querySelector(".status-text").textContent), "https://example.com/linked", "back to normal");

// Buttons aren't text to select
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("button")).userSelect), "none");

// Help: Index, Search, glossary popups, Related Topics
await click_menu_item(page, "Help Topics");
await page.waitForSelector(".help-window .help-tab");
const frame_text = () => page.evaluate(() => document.querySelector(".help-window iframe").contentDocument?.body?.textContent ?? "");
const frame_title = () => page.evaluate(() => document.querySelector(".help-window iframe").contentDocument?.title ?? "");
// Index: type a keyword, Enter; several topics → Topics Found
await page.click(".help-window .help-tab[data-tab=index]");
await page.waitForFunction(() => document.querySelectorAll(".help-index .help-pick-list li").length > 100, null, { timeout: 8000 });
await page.fill(".help-index input", "crop");
await page.keyboard.press("Enter");
await page.waitForFunction(() => document.querySelector(".help-window iframe").contentDocument?.title === "To crop a picture to a selection", null, { timeout: 8000 });
await page.fill(".help-index input", "transparency");
await page.keyboard.press("Enter");
await page.waitForSelector(".help-topics-found");
assert.match(await page.evaluate(() => document.querySelector(".help-topics-found").textContent), /To make part of a picture transparent/);
await page.keyboard.press("Enter"); // the first topic
await page.waitForFunction(() => /transparent/i.test(document.querySelector(".help-window iframe").contentDocument?.title ?? ""), null, { timeout: 8000 });
// Search
await page.click(".help-window .help-tab[data-tab=search]");
await page.fill(".help-search input", "defragment picture");
await page.keyboard.press("Enter");
await page.waitForFunction(() => /Topics found/.test(document.querySelector(".help-search-status").textContent), null, { timeout: 15000 });
assert.match(await page.evaluate(() => document.querySelector(".help-search .help-pick-list li").textContent), /To defragment your picture/);
await page.evaluate(() => [...document.querySelectorAll(".help-search button")].find((b) => b.textContent === "Display").click());
await page.waitForFunction(() => document.querySelector(".help-window iframe").contentDocument?.title === "To defragment your picture", null, { timeout: 8000 });
// Contents still works
await page.click(".help-window .help-tab[data-tab=contents]");
await page.evaluate(() => [...document.querySelectorAll(".help-window .item")].find((i) => i.textContent.trim() === "Erasing").click());
await page.evaluate(() => [...document.querySelectorAll(".help-window .item")].find((i) => i.textContent.trim() === "Erase a small area").click());
await page.waitForFunction(() => document.querySelector(".help-window iframe").contentDocument?.title === "To erase a small area", null, { timeout: 8000 });
await page.waitForTimeout(300);
// A glossary popup, with selectable text
await page.evaluate(() => document.querySelector(".help-window iframe").contentDocument.querySelector('a[data-topic-id="gl_pbrush_back"]').click());
assert.match(await page.evaluate(() => document.querySelector(".help-window iframe").contentDocument.querySelector(".glossary-popup")?.textContent ?? ""), /background color.*right mouse button/i);
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".help-window iframe").contentDocument.querySelector(".glossary-popup")).userSelect), "text");
await page.evaluate(() => document.querySelector(".help-window iframe").contentDocument.body.click());
assert.equal(await page.evaluate(() => document.querySelector(".help-window iframe").contentDocument.querySelector(".glossary-popup")), null, "closes");
// Related Topics are links now
assert.match(await frame_text(), /Related Topics/);
await page.evaluate(() => [...document.querySelector(".help-window iframe").contentDocument.querySelectorAll("a[href]")].find((a) => a.textContent === "To undo changes").click());
await page.waitForFunction(() => document.querySelector(".help-window iframe").contentDocument?.title === "To undo changes", null, { timeout: 8000 });
assert.equal(await frame_title(), "To undo changes");

await close();
console.log("todo-features: ok");
