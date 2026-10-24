// @ts-check
/* global UPNG */

// Reading and writing BMP files, with @huh-david/bmp-js (lib/bmp-js), a maintained fork of shaozilee's bmp-js.
// It decodes 1, 4, 8, 15, 16, 24 and 32 bits per pixel, RLE-compressed bitmaps, and CORE/INFO/V4/V5 headers.
// For the indexed formats (Monochrome, 16 Color and 256 Color Bitmap), the picture is first reduced to that many
// colors with UPNG.js's quantizer, and those colors become the file's color table.

import { decode, encode } from "../lib/bmp-js/bmp.js";

/**
 * @param {ImageData} imgData
 * @param {number} [bitsPerPixel] 1, 4, 8 or 24
 * @returns {ArrayBuffer}
 */
export function encodeBMP(imgData, bitsPerPixel = 24) {
	if (![1, 4, 8, 24].includes(bitsPerPixel)) {
		throw new Error(`not supported: ${bitsPerPixel} bits per pixel`);
	}
	const { width, height } = imgData;
	let rgba = imgData.data;
	/** @type {{ red: number, green: number, blue: number, quad: number }[]} */
	const palette = [];
	const indexed = bitsPerPixel <= 8;
	if (indexed) {
		const quantized = UPNG.quantize(imgData.data.buffer.slice(0), 2 ** bitsPerPixel);
		rgba = new Uint8ClampedArray(quantized.abuf);
		const inds = quantized.inds;
		for (let i = 0; i < quantized.plte.length; i += 1) {
			palette.push({ red: 0, green: 0, blue: 0, quad: 0 });
		}
		for (let i = 0; i < inds.length; i += 1) {
			const entry = palette[inds[i]];
			entry.red = rgba[i * 4];
			entry.green = rgba[i * 4 + 1];
			entry.blue = rgba[i * 4 + 2];
		}
	}
	// bmp-js takes ABGR. Indexed pixels get alpha 0, like the color table's entries, so each one finds its exact entry.
	const abgr = new Uint8Array(width * height * 4);
	for (let i = 0; i < abgr.length; i += 4) {
		abgr[i] = indexed ? 0 : 255;
		abgr[i + 1] = rgba[i + 2];
		abgr[i + 2] = rgba[i + 1];
		abgr[i + 3] = rgba[i];
	}
	const encoded = encode({ data: abgr, width, height }, {
		bitPP: /** @type {1 | 4 | 8 | 24} */ (bitsPerPixel),
		palette,
		orientation: "top-down",
	});
	return /** @type {ArrayBuffer} */ (encoded.data.buffer.slice(encoded.data.byteOffset, encoded.data.byteOffset + encoded.data.byteLength));
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{ bitsPerPixel: number, colorTable: { r: number, g: number, b: number }[], imageData: ImageData }}
 */
export function decodeBMP(arrayBuffer) {
	const decoded = decode(arrayBuffer, { toRGBA: true });
	const data = new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
	// Most 32-bit bitmaps leave the fourth byte at zero rather than meaning "invisible"; show those opaque.
	if (decoded.bitPP === 32) {
		let any_alpha = false;
		for (let i = 3; i < data.length; i += 4) {
			if (data[i] !== 0) { any_alpha = true; break; }
		}
		if (!any_alpha) {
			for (let i = 3; i < data.length; i += 4) { data[i] = 255; }
		}
	}
	return {
		bitsPerPixel: decoded.bitPP,
		colorTable: decoded.palette ? decoded.palette.map(({ red, green, blue }) => ({ r: red, g: green, b: blue })) : [],
		imageData: new ImageData(data, decoded.width, decoded.height),
	};
}
