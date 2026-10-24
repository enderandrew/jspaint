// Joke commands (src/menu-jokes.js): File › Taxes, Image › Mental, Adjustments › Attitude, Page › Doctor,
// Colors › Of the Wind, Help › Send. None change the picture. Plus: the Help Topics cover the new features,
// and every page in the contents (help/mspaint.hhc) and index (help/mspaint.hhk) exists.
import { assert, click_menu_item, open_paint } from "./helpers.mjs";

const { page, close } = await open_paint();
// A stand-in for images/clippy.jpg, so the test doesn't depend on that picture
await page.route("**/images/clippy.jpg", (route) => route.fulfill({
	contentType: "image/svg+xml",
	body: `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="100"><rect width="60" height="100" fill="#fff"/><rect x="20" y="10" width="20" height="80" fill="#88a"/></svg>`,
}));
const visible_text = () => page.evaluate(() => [...document.querySelectorAll(".window")].filter((w) => w.offsetParent).map((w) => w.textContent).join("\n"));
const button = (label) => page.evaluate((label) => {
	const b = [...document.querySelectorAll(".window button")].filter((b) => b.offsetParent && b.textContent === label).pop();
	if (!b) { throw new Error(`No button "${label}"`); }
	b.click();
}, label);
const status = () => page.evaluate(() => document.querySelector(".status-text").textContent);
const picture = () => page.evaluate(() => Array.from(main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data).join());
const original = await picture();

// File › Taxes: a progress bar, and no refund
await click_menu_item(page, "Taxes...");
await page.waitForSelector(".taxes-window progress");
await page.waitForFunction(() => /did not get a refund/.test(document.body.textContent), null, { timeout: 8000 });
assert.match(await visible_text(), /Refund: \$0\.00/);
await button("OK");

// Image › Mental, without the assistant showing
await click_menu_item(page, "Mental...");
await page.waitForFunction(() => /connected with your mental imagery/.test(document.body.textContent), null, { timeout: 8000 });
assert.match(await visible_text(), /booked a therapy appointment/);
await button("OK");

// ...and with it: it leaves to talk to someone, and comes back later
await page.clock.install();
await click_menu_item(page, "Show Assistant");
await page.waitForSelector(".ai-assistant-character");
await click_menu_item(page, "Mental...");
await page.clock.fastForward(4000);
await page.waitForFunction(() => /connected with your mental imagery/.test(document.body.textContent), null, { timeout: 8000 });
assert.match(await visible_text(), /is going to go talk to someone about it/);
assert.match(await page.evaluate(() => document.querySelector(".ai-assistant-text").textContent), /need to talk to someone/);
await button("OK");
await page.clock.fastForward(4000);
assert.equal(await page.evaluate(() => document.querySelector(".ai-assistant").hidden), true, "off to therapy");
assert.equal(await page.evaluate(() => localStorage.getItem("jspaint ai assistant hidden")), null, "not turned off, just away");
await page.clock.fastForward(60000);
assert.equal(await page.evaluate(() => document.querySelector(".ai-assistant").hidden), false, "back");
assert.match(await page.evaluate(() => document.querySelector(".ai-assistant-text").textContent), /back from therapy/);

// Adjustments › Attitude: coaching, step by step
await click_menu_item(page, "Attitude...");
await page.waitForSelector(".attitude-window");
assert.match(await page.evaluate(() => document.querySelector(".attitude-text").textContent), /adjust your attitude/);
for (let i = 0; i < 6; i++) { await button("Next"); }
assert.match(await page.evaluate(() => document.querySelector(".attitude-text").textContent), /adjusted by \+3%/);
await button("I feel better");
assert.match(await status(), /Attitude adjusted\. Picture unchanged/);

// Page › Doctor
await click_menu_item(page, "Doctor");
await page.waitForTimeout(300);
assert.match(await visible_text(), /A doctor has been paged to the OR/);
await button("OK");

// Colors › Of the Wind: not in your plan; "See Plans" opens Paint+
await click_menu_item(page, "Of the Wind");
await page.waitForTimeout(300);
assert.match(await visible_text(), /only available in Paint\+ Max/);
await button("See Plans");
await page.waitForSelector(".paint-plus-window");
await button("Close");
await click_menu_item(page, "Of the Wind");
await page.waitForTimeout(300);
await button("Join the Waitlist");
assert.match(await status(), /waitlist/);

// Help › Send
await click_menu_item(page, "Send");
await page.waitForTimeout(300);
assert.match(await visible_text(), /you are beyond help/);
await button("OK");

assert.equal(await picture(), original, "none of them changed the picture");

// Help Topics: the new sections are there, and open
await click_menu_item(page, "Help Topics");
await page.waitForFunction(() => [...document.querySelectorAll(".help-window .item")].some((item) => item.textContent.trim() === "Using the AI Menu"), null, { timeout: 8000 });
const folders = await page.evaluate(() => [...document.querySelectorAll(".help-window .item")].map((item) => item.textContent.trim()));
for (const folder of ["Using the AI Menu", "Adjusting Colors and Effects", "Special Effects", "Accessibility", "Subscriptions and Other Paperwork"]) {
	assert.ok(folders.includes(folder), `contents folder: ${folder}`);
}
await page.evaluate(() => [...document.querySelectorAll(".help-window .item")].find((item) => item.textContent.trim() === "Special Effects").click());
await page.waitForTimeout(200);
await page.evaluate(() => [...document.querySelectorAll(".help-window .item")].find((item) => /Defragment your picture/.test(item.textContent)).click());
await page.waitForFunction(() => /To defragment your picture/.test(document.querySelector(".help-window iframe").contentDocument?.body?.textContent ?? ""), null, { timeout: 8000 });

// Every page in the contents and the index exists, and every Related Topics link works
const missing = await page.evaluate(async () => {
	const pages = new Set();
	for (const file of ["help/mspaint.hhc", "help/mspaint.hhk"]) {
		const text = await (await fetch(file)).text();
		for (const [, local] of text.matchAll(/name="Local" value="([^"]+)"/g)) { pages.add(local); }
	}
	for (const local of [...pages]) {
		const doc = new DOMParser().parseFromString(await (await fetch(`help/${local}`)).text(), "text/html");
		for (const link of doc.querySelectorAll("a[href]")) {
			const href = link.getAttribute("href");
			if (!/^[a-z]+:/i.test(href)) { pages.add(href); }
		}
	}
	const results = await Promise.all([...pages].map(async (local) => [local, (await fetch(`help/${local}`)).ok]));
	return results.filter(([, ok]) => !ok).map(([local]) => local);
});
assert.deepEqual(missing, [], "help pages");

await close();
console.log("menu-jokes: ok");
