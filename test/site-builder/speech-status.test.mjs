// Speech Recognition's status bar line shows what was heard as text, with the understood part in bold: a "<" in
// what was heard used to go in as HTML. (The browser's speech recognition is replaced by a stand-in here.)
import { assert, click_menu_item, open_paint } from "./helpers.mjs";

const { page, close } = await open_paint({
	init: () => {
		window.SpeechRecognition = class {
			constructor() { window.__recognition = this; }
			start() { }
			stop() { }
			abort() { }
			addEventListener() { }
		};
		window.SpeechGrammarList = class { addFromString() { } };
	},
});

await click_menu_item(page, "Speech Recognition");
await page.waitForFunction(() => window.__recognition?.onresult, null, { timeout: 5000 });
const heard = 'pencil <img src=x onerror="window.__injected = true">';
const status = await page.evaluate((heard) => {
	window.__recognition.onresult({ results: [[{ transcript: heard, confidence: 0.9 }]] });
	const el = document.querySelector(".status-text");
	return { text: el.textContent, bold: [...el.querySelectorAll("b")].map((b) => b.textContent), images: el.querySelectorAll("img").length };
}, heard);
await page.waitForTimeout(200);
assert.equal(status.images, 0, "no HTML from what was heard");
assert.equal(await page.evaluate(() => window.__injected === true), false);
assert.equal(status.text, `Speech: ${heard}`, "shown as it was heard");
assert.equal(status.bold.length, 1, "one part in bold");
assert.match(status.bold[0], /pencil/i, "the understood part");
assert.equal(await page.evaluate(() => selected_tool.id), "TOOL_PENCIL", "and it was understood");

await close();
console.log("speech-status: ok");
