// The libraries in lib/ that read and write files: every BMP depth Paint saves (@huh-david/bmp-js), PNG (UPNG.js),
// and TIFF (UTIF.js) come back pixel for pixel; BMPs written by other programs (bottom-up rows, 32-bit with an
// unused alpha byte) open; a PDF's first page opens (PDF.js); and jQuery is the version index.html loads.
import { assert, open_paint } from "./helpers.mjs";

const { page, browser, close } = await open_paint();

assert.equal(await page.evaluate(() => window.jQuery.fn.jquery), "4.0.0");

// A picture with a few colors (black, white, red, blue), so the 1-bit file is just black and white
const draw = (colors) => page.evaluate(async (colors) => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Test" }, () => {
		main_ctx.fillStyle = "#fff";
		main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);
		colors.forEach((color, i) => {
			main_ctx.fillStyle = color;
			main_ctx.fillRect(10 + i * 37, 7 + i * 11, 33, 29 + i);
		});
	});
}, colors);

/** Saves the canvas as `mime_type`, opens the bytes again, and compares. */
const round_trip = (mime_type) => page.evaluate(async (mime_type) => {
	const { read_image_file, write_image_file } = await import("./src/functions.js");
	const blob = await new Promise((resolve) => write_image_file(main_canvas, mime_type, resolve));
	const info = await new Promise((resolve, reject) => read_image_file(blob, (error, info) => (error ? reject(error) : resolve(info))));
	const original = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);
	let different = 0;
	for (let i = 0; i < original.data.length; i++) {
		if (original.data[i] !== info.image_data.data[i]) { different++; }
	}
	const head = [...new Uint8Array(await blob.slice(0, 30).arrayBuffer())];
	return { format: info.file_format, width: info.image_data.width, height: info.image_data.height, different, size: blob.size, head };
}, mime_type);

const size = await page.evaluate(() => ({ width: main_canvas.width, height: main_canvas.height }));

await draw(["#000"]);
const mono = await round_trip("image/x-bmp-1bpp");
assert.equal(mono.different, 0, `1-bit BMP: ${JSON.stringify(mono)}`);
assert.equal(mono.head[28], 1, "1 bit per pixel");
assert.match(mono.format, /bmp/);

await draw(["#000", "#f00", "#00f", "#0f0", "#ff0"]);
for (const [mime_type, bpp] of [["image/x-bmp-4bpp", 4], ["image/x-bmp-8bpp", 8], ["image/bmp", 24]]) {
	const result = await round_trip(mime_type);
	assert.equal(result.different, 0, `${bpp}-bit BMP: ${JSON.stringify(result)}`);
	assert.deepEqual([result.width, result.height], [size.width, size.height]);
	assert.equal(result.head[28], bpp, `${bpp} bits per pixel`);
	assert.deepEqual(result.head.slice(0, 2), [0x42, 0x4D], "BM");
}
for (const [mime_type, format] of [["image/png", "image/png"], ["image/tiff", "image/tiff"]]) {
	const result = await round_trip(mime_type);
	assert.equal(result.different, 0, `${mime_type}: ${JSON.stringify(result)}`);
	assert.equal(result.format, format);
}

// BMPs from elsewhere: 24-bit with rows stored bottom to top, and 32-bit whose fourth byte is all zero
const opened = await page.evaluate(async () => {
	const { read_image_file } = await import("./src/functions.js");
	const make_bmp = (bpp) => {
		const width = 3, height = 2, stride = Math.ceil(width * bpp / 8 / 4) * 4;
		const bytes = new Uint8Array(54 + stride * height);
		const view = new DataView(bytes.buffer);
		bytes[0] = 0x42; bytes[1] = 0x4D;
		view.setUint32(2, bytes.length, true);
		view.setUint32(10, 54, true);
		view.setUint32(14, 40, true);
		view.setInt32(18, width, true);
		view.setInt32(22, height, true); // positive: bottom-up
		view.setUint16(26, 1, true);
		view.setUint16(28, bpp, true);
		// bottom row (stored first): red; top row: blue (BGR order)
		for (let x = 0; x < width; x++) {
			bytes.set([0, 0, 255], 54 + x * bpp / 8);
			bytes.set([255, 0, 0], 54 + stride + x * bpp / 8);
		}
		return new Blob([bytes]);
	};
	const read = (blob) => new Promise((resolve, reject) => read_image_file(blob, (error, info) => (error ? reject(error) : resolve(info))));
	const out = {};
	for (const bpp of [24, 32]) {
		const info = await read(make_bmp(bpp));
		out[bpp] = { top: [...info.image_data.data.slice(0, 4)], bottom: [...info.image_data.data.slice(12, 16)], format: info.file_format };
	}
	// A 256-color RLE-compressed bitmap (a run of 4 pixels of color 1, red) and a 16-bit one (red, then blue)
	const header = (bytes, { width, height, bpp, compression, colors, data_offset }) => {
		const view = new DataView(bytes.buffer);
		bytes[0] = 0x42; bytes[1] = 0x4D;
		view.setUint32(2, bytes.length, true);
		view.setUint32(10, data_offset, true);
		view.setUint32(14, 40, true);
		view.setInt32(18, width, true);
		view.setInt32(22, height, true);
		view.setUint16(26, 1, true);
		view.setUint16(28, bpp, true);
		view.setUint32(30, compression, true);
		view.setUint32(46, colors, true);
	};
	const rle = new Uint8Array(54 + 8 + 4);
	header(rle, { width: 4, height: 1, bpp: 8, compression: 1, colors: 2, data_offset: 62 });
	rle.set([0, 0, 0, 0, 0, 0, 255, 0], 54); // color table: black, red (BGR0)
	rle.set([4, 1, 0, 1], 62); // 4 × color 1; end of bitmap
	const rle_info = await read(new Blob([rle]));
	out.rle = [...rle_info.image_data.data.slice(12, 16)];
	const sixteen = new Uint8Array(54 + 4);
	header(sixteen, { width: 2, height: 1, bpp: 16, compression: 0, colors: 0, data_offset: 54 });
	new DataView(sixteen.buffer).setUint16(54, 0x7C00, true); // 5-5-5: red
	new DataView(sixteen.buffer).setUint16(56, 0x001F, true); // blue
	const sixteen_info = await read(new Blob([sixteen]));
	out[16] = [[...sixteen_info.image_data.data.slice(0, 4)], [...sixteen_info.image_data.data.slice(4, 8)]];
	return out;
});
assert.deepEqual(opened[24].top, [0, 0, 255, 255], "top row is blue");
assert.deepEqual(opened[24].bottom, [255, 0, 0, 255], "bottom row is red");
assert.deepEqual(opened[32].top, [0, 0, 255, 255], "a 32-bit BMP with no alpha opens opaque");
assert.deepEqual(opened.rle, [255, 0, 0, 255], "an RLE-compressed BMP opens");
assert.deepEqual(opened[16], [[248, 0, 0, 255], [0, 0, 248, 255]], "a 16-bit BMP opens (5 bits per channel: 31 → 248)");

// A PDF (printed by the browser): its first page opens, red where the page is red
const pdf_page = await browser.newPage();
await pdf_page.setContent(`<div style="width: 300px; height: 200px; background: #f00"></div>`);
const pdf_bytes = [...await pdf_page.pdf({ width: "400px", height: "300px", printBackground: true, pageRanges: "1" })];
await pdf_page.close();
const pdf = await page.evaluate(async (bytes) => {
	const { read_image_file } = await import("./src/functions.js");
	const info = await new Promise((resolve, reject) => read_image_file(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), (error, info) => (error ? reject(error) : resolve(info))));
	const { data, width, height } = info.image_data;
	const at = (x, y) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
	return { format: info.file_format, width, height, inside: at(50, 50), outside: at(width - 10, height - 10) };
}, pdf_bytes);
assert.equal(pdf.format, "application/pdf");
assert.ok(pdf.width > 400 && pdf.height > 300, `rendered at 1.5x: ${JSON.stringify(pdf)}`);
assert.deepEqual(pdf.inside, [255, 0, 0, 255], `red: ${JSON.stringify(pdf)}`);
assert.notDeepEqual(pdf.outside, [255, 0, 0, 255], "not red outside the box");

await close();
console.log("file-formats: ok");
