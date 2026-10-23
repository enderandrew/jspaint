// AI > Show Assistant (src/ai-assistant.js): the parody paperclip helper. Hidden in automated browsers until turned on;
// greets you; reacts to tools and to undoing a lot, once each and not too often; click it for a tip; drag it;
// turning it off says goodbye, hides it, and is remembered.
import { assert, click_menu_item, open_paint, select_tool } from "./helpers.mjs";

const { page, close } = await open_paint();
await page.clock.install(); // so the test can skip the quiet time between tips
// A stand-in for images/clippy.jpg (the real one isn't in the repo)
await page.route("**/images/clippy.jpg", (route) => route.fulfill({
	contentType: "image/svg+xml",
	body: `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="100"><rect width="60" height="100" fill="#fff"/><rect x="20" y="10" width="20" height="80" fill="#88a"/></svg>`,
}));
const visible = () => page.evaluate(() => { const el = document.querySelector(".ai-assistant"); return Boolean(el && !el.hidden && el.checkVisibility()); });
const bubble = () => page.evaluate(() => {
	const el = document.querySelector(".ai-assistant-bubble");
	return el && !el.hidden ? { text: el.querySelector(".ai-assistant-text").textContent, buttons: [...el.querySelectorAll(".ai-assistant-buttons button")].map((b) => b.textContent) } : null;
});
const answer = (label) => page.evaluate((label) => [...document.querySelectorAll(".ai-assistant-buttons button")].find((b) => b.textContent === label).click(), label);
const checked = () => page.evaluate(() => {
	const items = [...document.querySelectorAll('[aria-label="Show Assistant"]')];
	return items.some((item) => item.getAttribute("aria-checked") === "true");
});
const quiet_time = () => page.clock.fastForward(16000);

// Hidden in automated browsers until turned on
await page.waitForTimeout(3500);
assert.equal(await visible(), false);

// Turning it on: it says hi, and asks
await click_menu_item(page, "Show Assistant");
await page.waitForTimeout(300);
assert.equal(await visible(), true);
let said = await bubble();
assert.match(said.text, /It looks like you're trying to paint a picture/);
assert.deepEqual(said.buttons, ["Yes, please", "No thanks"]);
await answer("No thanks");
assert.match((await bubble()).text, /Watching\. Not blinking\./);
assert.ok(await page.evaluate(() => document.querySelector(".ai-assistant-character canvas") !== null), "uses images/clippy.jpg");

// It doesn't chime in again right away...
await select_tool(page, "Text");
assert.doesNotMatch((await bubble()).text, /writing a letter/);
// ...but after a while, picking a tool gets a tip about it
await select_tool(page, "Pencil");
await quiet_time();
await select_tool(page, "Text");
said = await bubble();
assert.match(said.text, /It looks like you're writing a letter/);
await answer("Get help with writing the letter");
assert.match((await bubble()).text, /Dear Sir or Madam/);

// Each tip only once
await quiet_time();
await select_tool(page, "Pencil");
await quiet_time();
await select_tool(page, "Text");
assert.doesNotMatch((await bubble())?.text ?? "", /writing a letter/);

// Undoing a lot
await quiet_time();
await page.evaluate(async () => {
	const { undoable } = await import("./src/functions.js");
	for (let i = 0; i < 4; i++) {
		undoable({ name: `Step ${i}` }, () => { main_ctx.fillStyle = `rgb(${i * 50}, 0, 0)`; main_ctx.fillRect(i * 10, 0, 10, 10); });
	}
	document.activeElement?.blur();
});
for (let i = 0; i < 3; i++) {
	await page.keyboard.press("Control+z");
	await page.waitForTimeout(100);
}
said = await bubble();
assert.match(said.text, /It looks like you're making mistakes/);
await answer("Yes");
assert.match((await bubble()).text, /twice as hard/);

// Clicking it gives a tip
await page.evaluate(() => { document.querySelector(".ai-assistant-text").textContent = ""; });
await page.click(".ai-assistant-character");
said = await bubble();
assert.ok(said.text.length > 10, `a tip: ${said.text}`);

// Dragging moves it (and doesn't give a tip)
const before = await page.locator(".ai-assistant-character").boundingBox();
await page.evaluate(() => { document.querySelector(".ai-assistant-text").textContent = "(unchanged)"; });
await page.mouse.move(before.x + 30, before.y + 50);
await page.mouse.down();
await page.mouse.move(before.x - 170, before.y - 150, { steps: 8 });
await page.mouse.up();
const after = await page.locator(".ai-assistant-character").boundingBox();
assert.ok(Math.abs(after.x - (before.x - 200)) < 3 && Math.abs(after.y - (before.y - 200)) < 3, `moved: ${JSON.stringify([before, after])}`);
assert.equal((await bubble()).text, "(unchanged)");

// Turning it off: goodbye, then gone, and remembered
assert.equal(await checked(), true);
await click_menu_item(page, "Show Assistant");
assert.match((await bubble()).text, /Recycle Bin/);
await page.clock.fastForward(2000);
await page.waitForTimeout(100);
assert.equal(await visible(), false);
assert.equal(await page.evaluate(() => localStorage.getItem("jspaint ai assistant hidden")), "1");
assert.equal(await checked(), false);

await close();
console.log("ai-assistant: ok");
