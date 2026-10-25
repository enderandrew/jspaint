// Undo history memory (history-storage.js): steps that haven't been used lately are packed down to just the
// rectangle they changed, so the history no longer grows by a whole picture per step (not even for a photo);
// undo, redo, branches, replacing a step's picture, and reading every step still give back exactly the right
// pictures.
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
assert.ok(s.deltas >= 30, `packed steps hold only what they changed: ${JSON.stringify(s)}`);
assert.ok(s.packed_bytes / s.packed < 4096, `a packed step is a few kilobytes at most: ${JSON.stringify(s)}`);
console.log(`undo-memory: 41 steps hold ${total_mb.toFixed(1)} MB instead of ${before_mb.toFixed(1)} MB (${(s.packed_bytes / 1024).toFixed(0)} KB of it packed)`);

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
	while (stack.length) {
		const node = stack.pop();
		if (node.name === "Step 99") { go_to_history_node(node); }
		stack.push(...node.futures);
	}
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

// Replacing a step's picture outright (as fixing a change made outside of undoable does) leaves the steps
// built on it as they were
await page.evaluate(async () => { (await import("./src/functions.js")).go_to_history_node(root_history_node); });
const later = await page.evaluate(async () => {
	const nodes = [];
	const stack = [root_history_node];
	while (stack.length) { const node = stack.pop(); nodes.push(node); stack.push(...node.futures); }
	const step = (name) => nodes.find((node) => node.name === name);
	const sum = (image_data) => {
		let h = 0;
		for (let i = 0; i < image_data.data.length; i += 7) { h = (h * 31 + image_data.data[i]) | 0; }
		return h;
	};
	const before = [sum(step("Step 6").image_data), sum(step("Step 7").image_data)];
	// (read other steps, then give it a moment, so Step 6 and 7 are packed again, built on Step 5)
	for (let i = 20; i < 36; i++) { void step(`Step ${i}`).image_data; }
	await new Promise((resolve) => { setTimeout(resolve, 1500); });
	const { history_storage_stats } = await import("./src/history-storage.js");
	if (history_storage_stats([step("Step 6"), step("Step 7")]).deltas !== 2) { throw new Error("Step 6 and 7 should be packed as changes"); }
	const blank = new ImageData(main_canvas.width, main_canvas.height);
	step("Step 5").image_data = blank;
	return { before, after: [sum(step("Step 6").image_data), sum(step("Step 7").image_data)], replaced: sum(step("Step 5").image_data) === sum(blank) };
});
assert.deepEqual(later.after, later.before, "the later steps kept their pictures");
assert.ok(later.replaced);

await close();

// A photo (noise doesn't compress at all): a stroke still costs only the rectangle it touched
const photo = await open_paint();
await photo.page.evaluate(async () => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Photo" }, () => {
		const noise = main_ctx.createImageData(main_canvas.width, main_canvas.height);
		for (let i = 0; i < noise.data.length; i++) { noise.data[i] = (i % 4 === 3) ? 255 : Math.random() * 256; }
		main_ctx.putImageData(noise, 0, 0);
	});
	for (let i = 0; i < 30; i++) {
		undoable({ name: `Dab ${i}` }, () => { main_ctx.fillStyle = "#000"; main_ctx.fillRect(20 + i * 10, 40, 8, 8); });
	}
});
await photo.page.waitForTimeout(1500);
const photo_stats = await photo.page.evaluate(async () => {
	const { history_storage_stats } = await import("./src/history-storage.js");
	const nodes = [];
	const stack = [root_history_node];
	while (stack.length) { const node = stack.pop(); nodes.push(node); stack.push(...node.futures); }
	return history_storage_stats(nodes);
});
const photo_step_bytes = await photo.page.evaluate(() => main_canvas.width * main_canvas.height * 4);
assert.ok(photo_stats.packed >= 25, JSON.stringify(photo_stats));
assert.ok(photo_stats.packed_bytes < photo_step_bytes * 2, `30 dabs on a photo pack to ${(photo_stats.packed_bytes / 1048576).toFixed(2)} MB (the photo itself is ${(photo_step_bytes / 1048576).toFixed(1)} MB a step)`);
for (let i = 0; i < 31; i++) { await photo.page.evaluate(async () => { (await import("./src/functions.js")).undo(); }); }
assert.equal(await photo.page.evaluate(() => current_history_node === root_history_node), true);
for (let i = 0; i < 31; i++) { await photo.page.evaluate(async () => { (await import("./src/functions.js")).redo(); }); }
assert.deepEqual(await photo.page.evaluate(() => [...main_ctx.getImageData(20 + 29 * 10 + 2, 42, 1, 1).data]), [0, 0, 0, 255], "the last dab, after undoing and redoing everything");
await photo.close();
console.log("undo-memory: ok");
