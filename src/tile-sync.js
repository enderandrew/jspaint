// @ts-check
// The picture in pieces, for sending only what changed: a multi-user session (sessions.js) keeps the picture in its
// Firebase database as 64×64 tiles, each a small PNG, so a stroke sends the few tiles it touched instead of the
// whole picture as one PNG every time.

/** Tile size, in pixels. */
export const TILE_SIZE = 64;

/** @typedef {{ key: string, x: number, y: number, width: number, height: number }} Tile */

/**
 * Every tile of a picture this size, in reading order. A tile's key is "<column>_<row>".
 * @param {number} width
 * @param {number} height
 * @returns {Tile[]}
 */
export function tiles_of(width, height) {
	const tiles = [];
	for (let y = 0, row = 0; y < height; y += TILE_SIZE, row++) {
		for (let x = 0, column = 0; x < width; x += TILE_SIZE, column++) {
			tiles.push({ key: `${column}_${row}`, x, y, width: Math.min(TILE_SIZE, width - x), height: Math.min(TILE_SIZE, height - y) });
		}
	}
	return tiles;
}

/**
 * The tile a key names, or null if it isn't one of this picture's.
 * @param {string} key
 * @param {number} width
 * @param {number} height
 * @returns {Tile | null}
 */
export function tile_for_key(key, width, height) {
	const match = /^(\d{1,4})_(\d{1,4})$/.exec(key);
	if (!match) { return null; }
	const x = Number(match[1]) * TILE_SIZE, y = Number(match[2]) * TILE_SIZE;
	if (x >= width || y >= height) { return null; }
	return { key, x, y, width: Math.min(TILE_SIZE, width - x), height: Math.min(TILE_SIZE, height - y) };
}

/**
 * The tiles where two pictures of the same size differ.
 * @param {ImageData} before
 * @param {ImageData} after
 * @returns {Tile[]}
 */
export function changed_tiles(before, after) {
	if (before.width !== after.width || before.height !== after.height) {
		throw new Error("changed_tiles: the pictures aren't the same size");
	}
	const a = new Uint32Array(before.data.buffer, before.data.byteOffset, before.width * before.height);
	const b = new Uint32Array(after.data.buffer, after.data.byteOffset, after.width * after.height);
	const { width } = after;
	return tiles_of(after.width, after.height).filter((tile) => {
		for (let row = tile.y; row < tile.y + tile.height; row++) {
			const start = row * width + tile.x;
			for (let i = start; i < start + tile.width; i++) {
				if (a[i] !== b[i]) { return true; }
			}
		}
		return false;
	});
}

/**
 * Copies a tile's pixels from one picture to another of the same size.
 * @param {ImageData} from
 * @param {ImageData} to
 * @param {Tile} tile
 */
export function copy_tile(from, to, tile) {
	for (let row = tile.y; row < tile.y + tile.height; row++) {
		const start = (row * from.width + tile.x) * 4;
		to.data.set(from.data.subarray(start, start + tile.width * 4), start);
	}
}

/**
 * A tile of a picture as a PNG data: URL.
 * @param {ImageData} image_data
 * @param {Tile} tile
 * @returns {string}
 */
export function encode_tile(image_data, tile) {
	const canvas = document.createElement("canvas");
	canvas.width = tile.width;
	canvas.height = tile.height;
	const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
	ctx.putImageData(image_data, -tile.x, -tile.y, tile.x, tile.y, tile.width, tile.height);
	return canvas.toDataURL("image/png");
}

/**
 * Loads a tile's PNG.
 * @param {string} uri
 * @returns {Promise<HTMLImageElement>}
 */
export function decode_tile(uri) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("A tile of the picture couldn't be read."));
		img.src = uri;
	});
}

/**
 * A quick fingerprint of a picture's pixels (FNV-1a over 32-bit pixels), to tell whether it changed since last time.
 * @param {ImageData} image_data
 * @returns {string}
 */
export function pixels_fingerprint(image_data) {
	const pixels = new Uint32Array(image_data.data.buffer, image_data.data.byteOffset, image_data.width * image_data.height);
	let hash = 0x811c9dc5;
	for (let i = 0; i < pixels.length; i++) {
		hash ^= pixels[i];
		hash = Math.imul(hash, 0x01000193);
	}
	return `${image_data.width}x${image_data.height}:${(hash >>> 0).toString(36)}`;
}
