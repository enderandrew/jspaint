// Undo history memory (history-storage.js): steps that haven't been used lately are packed, so the history no
// longer grows by a whole uncompressed picture per step; undo, redo, branches, and reading every step still
// give back exactly the right pictures.
import { assert, open_paint } from "./helpers.mjs";

const { page, close } = await open_paint();

const checksum = () => page.evaluate(() => {
	const d = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data;
	let h = 0;
	for (let i = 0; i < d.length; i += 7) { h = (h * 31 + d[i]) | 0; }
	return h;
});
const stats = () => page.evaluate(async () => {
	const { history_storage_stats } = await import("./src/history-storage.js");
	const nodes = [];
	const stack = [root_history_node];
	while (stack.length) { const node = stack.pop(); nodes.push(node); stack.push(...node.futures); }
	return history_storage_stats(nodes);
});
const draw_step = (i) => page.evaluate(async (i) => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: `Step ${i}` }, () => {
		main_ctx.fillStyle = `hsl(${(i * 37) % 360}, 70%, 50%)`;
		main_ctx.fillRect((i * 13) % 700, (i * 29) % 500, 60 + (i % 5) * 10, 40);
	});
}, i);
const idle = () => page.waitForTimeout(1500);
const undo = () => page.evaluate(async () => { (await import("./src/functions.js")).undo(); });
const redo = () => page.evaluate(async () => { (await import("./src/functions.js")).redo(); });

// 40 steps: the history packs all but a few
const expected = [await checksum()];
for (let i = 1; i <= 40; i++) {
	await draw_step(i);
	expected.push(await checksum());
}
await idle();
let s = await stats();
const step_bytes = await page.evaluate(() => main_canvas.width * main_canvas.height * 4);
assert.equal(s.nodes, 41);
assert.ok(s.unpacked <= 4, `few steps unpacked: ${JSON.stringify(s)}`);
assert.ok(s.packed >= 36, `the rest packed: ${JSON.stringify(s)}`);
const total_mb = (s.packed_bytes + s.unpacked_bytes) / 1048576;
const before_mb = (41 * step_bytes) / 1048576;
assert.ok(total_mb < before_mb / 5, `history is ${total_mb.toFixed(1)} MB (was ${before_mb.toFixed(1)} MB)`);
console.log(`undo-memory: 41 steps hold ${total_mb.toFixed(1)} MB instead of ${before_mb.toFixed(1)} MB`);

// Undo all the way back, checking every picture; then redo all the way forward
for (let i = 39; i >= 0; i--) {
	await undo();
	assert.equal(await checksum(), expected[i], `undo to step ${i}`);
}
for (let i = 1; i <= 40; i++) {
	await redo();
	assert.equal(await checksum(), expected[i], `redo to step ${i}`);
}

// A branch: undo 10, draw something else, then jump back to the old branch's last step (History window's way)
for (let i = 0; i < 10; i++) { await undo(); }
await draw_step(99);
const branch_sum = await checksum();
await idle();
assert.equal(await page.evaluate(async () => {
	const { go_to_history_node } = await import("./src/functions.js");
	const nodes = [];
	const stack = [root_history_node];
	while (stack.length) { const node = stack.pop(); nodes.push(node); stack.push(...node.futures); }
	go_to_history_node(nodes.find((node) => node.name === "Step 40"));
	return current_history_node.name;
}), "Step 40");
assert.equal(await checksum(), expected[40], "the old branch's last step");
await page.evaluate(async () => {
	const { go_to_history_node } = await import("./src/functions.js");
	const stack = [root_history_node];
	while (stack.length) { const node = stack.pop(); if (node.name === "Step 99") { go_to_history_node(node); } stack.push(...node.futures); }
});
assert.equal(await checksum(), branch_sum, "and back to the new branch");

// Reading every step at once (as an animated GIF of the history does) keeps only a bounded number unpacked
const peak = await page.evaluate(async () => {
	const { history_storage_stats } = await import("./src/history-storage.js");
	const nodes = [];
	const stack = [root_history_node];
	while (stack.length) { const node = stack.pop(); nodes.push(node); stack.push(...node.futures); }
	let most = 0;
	for (const node of nodes) {
		if (!node.image_data) { throw new Error(`${node.name} has no picture`); }
		most = Math.max(most, history_storage_stats(nodes).unpacked);
	}
	return most;
});
assert.ok(peak <= 12, `at most 12 unpacked while reading them all (was ${peak})`);

// Live editing's rebase reaches packed steps too, without unpacking them
await idle();
const rebased = await page.evaluate(async () => {
	const { patch_history_image_data, history_storage_stats } = await import("./src/history-storage.js");
	const nodes = [];
	const stack = [root_history_node];
	while (stack.length) { const node = stack.pop(); nodes.push(node); stack.push(...node.futures); }
	const before = history_storage_stats(nodes).unpacked;
	const red = new Uint8ClampedArray(10 * 10 * 4);
	for (let i = 0; i < red.length; i += 4) { red[i] = 255; red[i + 3] = 255; }
	for (const node of nodes) { patch_history_image_data(node, 5, 5, 10, 10, red); }
	const after = history_storage_stats(nodes).unpacked;
	const old = nodes.find((node) => node.name === "Step 3");
	return { before, after, pixel: [...old.image_data.data.slice((7 * old.image_data.width + 7) * 4, (7 * old.image_data.width + 7) * 4 + 4)] };
});
assert.equal(rebased.after, rebased.before, "patching didn't unpack anything");
assert.deepEqual(rebased.pixel, [255, 0, 0, 255], "an old packed step has the patch");

await close();
console.log("undo-memory: ok");
