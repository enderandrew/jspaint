// Libraries that only some features use load when first needed, not with the page: the palette library, UTIF.js,
// Tracky Mouse, and the image tracer, plus the message box sounds and the News demo video. Each still works.
/* global palette */
import { assert, open_paint } from "./helpers.mjs";

const { page, close } = await open_paint();
const requested = [];
page.on("request", (request) => { requested.push(new URL(request.url()).pathname); });

// None of them came with the page
const loaded_scripts = await page.evaluate(() => [...document.scripts].map((s) => s.getAttribute("src") || ""));
for (const lib of ["anypalette", "UTIF", "tracky-mouse.js", "imagetracer"]) {
	assert.ok(!loaded_scripts.some((src) => src.includes(lib)), `${lib} isn't loaded with the page`);
}
assert.equal(await page.evaluate(() => typeof window.AnyPalette), "undefined");
assert.equal(await page.evaluate(() => document.querySelector("#news video").getAttribute("preload")), "none");
assert.equal(await page.evaluate(() => document.querySelector("#news video").hasAttribute("autoplay")), false);
const performance_names = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => new URL(entry.name).pathname));
for (const file of ["/images/tracky-mouse-jspaint-demo.mp4", "/audio/chord.wav"]) {
	assert.ok(!performance_names.includes(file), `${file} isn't downloaded with the page`);
}

// The Save Colors file types listed in file-format-data.js are exactly the ones the palette library can write
const formats = await page.evaluate(async () => {
	const { palette_formats } = await import("./src/file-format-data.js");
	const { load_anypalette } = await import("./src/helpers.js");
	await load_anypalette();
	const writable = Object.entries(window.AnyPalette.formats).filter(([, format]) => format.write).map(([id, format]) => [id, format.name, format.fileExtensions]);
	return { listed: palette_formats.map((format) => [format.formatID, format.name, format.extensions]), writable };
});
assert.deepEqual([...formats.listed].sort(), [...formats.writable].sort(), "the listed palette formats match AnyPalette.formats");
assert.deepEqual(formats.listed.slice(0, 2).map(([id]) => id), ["RIFF_PALETTE", "GIMP_PALETTE"], "RIFF PAL, then GIMP, first");

// Opening a palette file (a GIMP palette) still works, through the same path as File > Open
const colors = await page.evaluate(async () => {
	const { open_from_file } = await import("./src/functions.js");
	const gpl = "GIMP Palette\nName: Test\n#\n255   0   0\tRed\n  0 255   0\tGreen\n  0   0 255\tBlue\n";
	open_from_file(new File([gpl], "test.gpl", { type: "" }));
	await new Promise((resolve) => { setTimeout(resolve, 1500); });
	return palette.slice(0, 3);
});
assert.equal(colors.length, 3);
assert.match(colors.join(" "), /255.*0.*0/);

// Saving the palette (Colors > Save Colors' blob)
const saved = await page.evaluate(async () => {
	window.systemHooks.showSaveFileDialog = async ({ getBlob }) => { window.__palette_blob = await (await getBlob("GIMP_PALETTE")).text(); };
	const { menus } = await import("./src/menus.js");
	const item = Object.values(menus).flat().find((entry) => entry && entry.label === "&Save Colors");
	item.action();
	await new Promise((resolve) => { setTimeout(resolve, 500); });
	return window.__palette_blob;
});
assert.match(saved, /^GIMP Palette/);

// TIFF loads UTIF.js on demand (file-formats.test.mjs round-trips it pixel for pixel)
const tiff = await page.evaluate(async () => {
	const { read_image_file, write_image_file } = await import("./src/functions.js");
	const blob = await new Promise((resolve) => { write_image_file(main_canvas, "image/tiff", resolve); });
	const info = await new Promise((resolve, reject) => { read_image_file(blob, (error, info) => (error ? reject(error) : resolve(info))); });
	return { format: info.file_format, utif: typeof window.UTIF };
});
assert.deepEqual(tiff, { format: "image/tiff", utif: "object" });

// The image tracer loads when something is sketched
const traced = await page.evaluate(async () => {
	const { trace_and_sketch, trace_and_sketch_stop } = await import("./src/speech-recognition.js");
	const image_data = new ImageData(20, 20);
	for (let i = 0; i < image_data.data.length; i += 4) { image_data.data[i + 3] = 255; }
	trace_and_sketch(image_data);
	await new Promise((resolve) => { setTimeout(resolve, 800); });
	trace_and_sketch_stop();
	return typeof window.ImageTracer;
});
assert.equal(traced, "object");

// The message box sound is fetched when a message box first opens
await page.evaluate(async () => { (await import("./src/msgbox.js")).showMessageBox({ message: "Hi" }); });
await page.waitForTimeout(500);
assert.ok(requested.includes("/audio/chord.wav"), "the sound is fetched on first use");
await page.evaluate(() => [...document.querySelectorAll(".window button")].filter((b) => b.offsetParent && b.textContent.trim() === "OK").pop().click());

await close();
console.log("lazy-libraries: ok");
