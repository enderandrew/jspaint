// Help > Terms of Service (src/terms-of-service.js) and Help > Upgrade to Paint+... (src/paint-plus.js), both parodies.
// Terms: "I Agree" only after scrolling to the bottom; "I Disagree" agrees too; the "we've updated" pop-up shows on load
// until agreed (not in automated browsers). Paint+: subscribing (paying by watching an ad) adds a badge; upgrading;
// canceling goes through "are you sure", a discount offer, and a survey.
import { assert, click_menu_item, open_paint } from "./helpers.mjs";

const visible_text = (page) => page.evaluate(() => [...document.querySelectorAll(".window")].filter((w) => w.offsetParent).map((w) => w.textContent).join("\n"));
const click_button = (page, label) => page.evaluate((label) => {
	const button = [...document.querySelectorAll(".window button")].filter((b) => b.offsetParent && b.textContent === label).pop();
	if (!button) { throw new Error(`No button "${label}"`); }
	button.click();
}, label);
const badge = (page) => page.evaluate(() => document.querySelector(".paint-plus-badge")?.textContent ?? null);
const saved_plan = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("jspaint paint+ plan") ?? "null")?.plan ?? "free");

// Terms of Service
{
	const { page, close } = await open_paint();
	await page.waitForTimeout(2000);
	assert.equal(await page.$(".terms-of-service-window"), null, "no pop-up in automated browsers");

	await click_menu_item(page, "Terms of Service");
	await page.waitForSelector(".terms-of-service-window .terms-of-service-text");
	assert.match(await visible_text(page), /Pixels Are Licensed, Not Sold/);
	assert.equal(await page.evaluate(() => document.querySelector(".terms-agree").disabled), true, "can't agree without scrolling");
	await page.evaluate(() => { const terms = document.querySelector(".terms-of-service-text"); terms.scrollTop = terms.scrollHeight; });
	await page.waitForTimeout(200);
	assert.equal(await page.evaluate(() => document.querySelector(".terms-agree").disabled), false, "scrolled to the bottom");
	await click_button(page, "I Agree");
	await page.waitForTimeout(200);
	assert.equal(await page.evaluate(() => localStorage.getItem("jspaint terms of service agreed")), "98.0.3");

	// Disagreeing also agrees
	await page.evaluate(() => localStorage.removeItem("jspaint terms of service agreed"));
	await click_menu_item(page, "Terms of Service");
	await page.waitForSelector(".terms-of-service-window");
	await click_button(page, "I Disagree");
	await page.waitForTimeout(300);
	assert.match(await visible_text(page), /filed under "Agreements\."/);
	assert.equal(await page.evaluate(() => localStorage.getItem("jspaint terms of service agreed")), "98.0.3");
	await click_button(page, "OK");
	await close();
}

// The "we've updated" pop-up on load, for people (not automated browsers), until agreed
{
	const as_a_person = () => {
		Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
		try { localStorage.setItem("jspaint ai assistant hidden", "1"); } catch { /* fine */ }
	};
	const { page, close } = await open_paint({ init: as_a_person });
	await page.waitForSelector(".terms-of-service-window", { timeout: 5000 });
	assert.match(await visible_text(page), /We've updated our Terms of Service/);
	await page.evaluate(() => { const terms = document.querySelector(".terms-of-service-text"); terms.scrollTop = terms.scrollHeight; });
	await page.waitForTimeout(200);
	await click_button(page, "I Agree");
	await page.reload();
	await page.waitForSelector(".main-canvas");
	await page.waitForTimeout(2500);
	assert.equal(await page.$(".terms-of-service-window"), null, "agreed: no pop-up");
	await close();
}

// Paint+
{
	const { page, close } = await open_paint();
	assert.equal(await badge(page), null);

	// The plans; pay by watching an ad
	await click_menu_item(page, "Upgrade to Paint+...");
	await page.waitForSelector(".paint-plus-window");
	assert.match(await visible_text(page), /\$4\.99\/month/);
	assert.match(await visible_text(page), /Paint\+ Pro Max Ultra/);
	assert.equal(await page.$$eval(".paint-plus-window input", (inputs) => inputs.every((input) => input.type === "radio")), true, "no payment details asked for");
	await page.click("label[for=paint-plus-payment-ad]");
	await page.click(".paint-plus-choose-plus");
	await page.waitForSelector(".paint-plus-ad");
	assert.match(await visible_text(page), /Tired of ads\?/);
	assert.equal(await page.evaluate(() => document.querySelector(".paint-plus-skip").disabled), true, "can't skip yet");
	await page.waitForFunction(() => !document.querySelector(".paint-plus-skip").disabled, null, { timeout: 8000 });
	await page.click(".paint-plus-skip");
	await page.waitForFunction(() => /Welcome to Paint\+!/.test(document.body.textContent), null, { timeout: 8000 });
	assert.equal(await badge(page), "PLUS");
	assert.equal(await saved_plan(page), "plus");
	await click_button(page, "OK");

	// Remembered
	await page.reload();
	await page.waitForSelector(".main-canvas");
	await page.waitForTimeout(800);
	assert.equal(await badge(page), "PLUS");

	// Upgrading
	await click_menu_item(page, "Upgrade to Paint+...");
	await page.waitForSelector(".paint-plus-manage");
	assert.match(await visible_text(page), /Next billing date: never, probably/);
	await click_button(page, "Upgrade to Pro Max Ultra");
	await page.waitForFunction(() => /Welcome to Paint\+ Pro Max Ultra!/.test(document.body.textContent), null, { timeout: 8000 });
	assert.match(await badge(page), /PRO MAX ULTRA/);
	assert.equal(await saved_plan(page), "ultra");
	await click_button(page, "OK");

	// Canceling, take one: the discount offer keeps you subscribed
	await click_menu_item(page, "Upgrade to Paint+...");
	await page.waitForSelector(".paint-plus-manage");
	await click_button(page, "Cancel Subscription");
	await page.waitForTimeout(300);
	assert.match(await visible_text(page), /You'll lose your badge/);
	await click_button(page, "Continue canceling");
	await page.waitForTimeout(300);
	assert.match(await visible_text(page), /how about 50% off/);
	await click_button(page, "Accept offer");
	await page.waitForTimeout(300);
	assert.equal(await saved_plan(page), "ultra", "still subscribed");

	// Take two: all the way through
	await click_menu_item(page, "Upgrade to Paint+...");
	await page.waitForSelector(".paint-plus-manage");
	assert.match(await visible_text(page), /50% off, still \$0\.00/);
	await click_button(page, "Cancel Subscription");
	await page.waitForTimeout(300);
	await click_button(page, "Continue canceling");
	await page.waitForTimeout(300);
	await click_button(page, "No, cancel");
	await page.waitForTimeout(300);
	assert.match(await visible_text(page), /tell us why you're leaving/);
	await click_button(page, "I wanted to see what would happen");
	await page.waitForTimeout(300);
	assert.match(await visible_text(page), /has been canceled/);
	assert.equal(await badge(page), null);
	assert.equal(await saved_plan(page), "free");
	await click_button(page, "OK");

	await close();
}

console.log("paint-plus: ok");
