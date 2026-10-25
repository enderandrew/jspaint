// The browser backup (sessions.js LocalSession) writes the picture only when its pixels changed: a change to
// something else (page elements, text, moving things) used to encode and write the whole picture again too.
import { assert, open_paint } from "./helpers.mjs";

const { page, close } = await open_paint({
	init: () => {
		// Count the pictures written to IndexedDB (a PNG blob each)
		window.__picture_writes = 0;
		const put = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (value, ...rest) {
			if (value && value.blob instanceof Blob && !value.stickers) { window.__picture_writes++; }
			return put.call(this, value, ...rest);
		};
	},
});
const writes = () => page.evaluate(() => window.__picture_writes);
const settle = () => page.waitForTimeout(600);
await settle();

// A drawing: the picture is written
let before = await writes();
await page.evaluate(async () => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Dab" }, () => { main_ctx.fillStyle = "#f0f"; main_ctx.fillRect(10, 10, 30, 30); });
});
await settle();
assert.equal(await writes(), before + 1, "a change to the picture is backed up");

// Something else changes (the layers are saved; the picture isn't written again)
before = await writes();
for (let i = 0; i < 3; i++) {
	await page.evaluate(() => { $(window).triggerHandler("session-update"); });
	await settle();
}
assert.equal(await writes(), before, "an unchanged picture isn't written again");

// And it's still the picture that comes back after a reload
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".main-canvas");
await page.waitForFunction(() => main_ctx.getImageData(20, 20, 1, 1).data[1] === 0, null, { timeout: 10000 });
assert.deepEqual(await page.evaluate(() => [...main_ctx.getImageData(20, 20, 1, 1).data]), [255, 0, 255, 255]);

await close();
console.log("backup-writes: ok");
