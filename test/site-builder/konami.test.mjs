// The Konami code (↑ ↑ ↓ ↓ ← → ← → B A) plays audio/KONAMI.ogg, each time it's entered (konami.js).
import { assert, open_paint } from "./helpers.mjs";

const { page, close } = await open_paint({
	init: () => {
		window.__played = [];
		HTMLMediaElement.prototype.play = function () {
			window.__played.push(this.src);
			return Promise.resolve();
		};
	},
});
const enter_code = async () => {
	for (const key of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) {
		await page.keyboard.press(key);
	}
	await page.waitForTimeout(200);
};
await page.mouse.click(5, 300); // (keys go to the page, not a text box)
await enter_code();
const played = await page.evaluate(() => window.__played);
assert.equal(played.length, 1, "played once");
assert.match(played[0], /\/audio\/KONAMI\.ogg$/);
assert.equal(await page.evaluate(async (src) => (await fetch(src)).headers.get("content-length") > 1000, played[0]), true, "the file is there");
// Again, and it plays again; a wrong sequence plays nothing
await page.keyboard.press("Escape");
for (const key of ["ArrowUp", "ArrowDown", "b", "a"]) { await page.keyboard.press(key); }
assert.equal((await page.evaluate(() => window.__played)).length, 1, "not for a wrong sequence");
await enter_code();
assert.equal((await page.evaluate(() => window.__played)).length, 2, "again for the code again");
await page.keyboard.press("Escape");
await close();
console.log("konami: ok");
