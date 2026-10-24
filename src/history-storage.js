// @ts-check
/* global current_history_node, pako */

// Undo history keeps a whole picture for every step, so it used to grow without limit: about 1.8 MB per step at
// 800×600 (60 strokes: 110 MB), and several times that for a long web page. Now only the few steps used most
// recently (always including the current one) keep their pixels as an ImageData; the rest are compressed with
// pako's deflate. Paint pictures are mostly flat color, so a step typically shrinks to a few kilobytes.
//
// Nothing else has to change: `node.image_data` is a property that unpacks the step when it's read (and keeps
// it unpacked until it's the least recently used again), and packs nothing when it's set.
//  - Packing happens when the browser is idle, for steps past the first few; a loop that reads many steps
//    (an animated GIF of the history, say) packs synchronously past a hard limit, so memory stays bounded there too.
//  - Live editing changes a rectangle of every step at once: patch_history_image_data() queues it on packed steps,
//    to be applied when they're unpacked, instead of unpacking them all.

/** Steps whose pixels stay unpacked when the browser has a moment. */
const KEEP_UNPACKED = 4;
/** Past this many, the least recently used steps are packed right away. */
const MAX_UNPACKED = 12;
/** Pictures smaller than this aren't worth packing (bytes of RGBA). */
const MIN_PACK_BYTES = 64 * 1024;

/**
 * @typedef {{
 *   raw: ImageData | null,
 *   packed: Uint8Array | null,
 *   width: number,
 *   height: number,
 *   colorSpace: PredefinedColorSpace | undefined,
 *   pending: { x: number, y: number, width: number, height: number, data: Uint8ClampedArray }[],
 * }} Storage
 */

/** @type {WeakMap<object, Storage>} */
const storage_of = new WeakMap();
/** Nodes holding unpacked pixels, least recently used first. @type {object[]} */
const unpacked = [];

let idle_scheduled = false;

/** @param {object} node */
function touch(node) {
	const index = unpacked.indexOf(node);
	if (index !== -1) { unpacked.splice(index, 1); }
	unpacked.push(node);
	// Past the hard limit, pack now (oldest first), so reading the whole history can't hold it all at once
	while (unpacked.length > MAX_UNPACKED) {
		const oldest = unpacked.find((other) => other !== node && other !== current_history_node);
		if (!oldest) { break; }
		pack(oldest);
	}
	schedule_idle_packing();
}

function schedule_idle_packing() {
	if (idle_scheduled || unpacked.length <= KEEP_UNPACKED) { return; }
	idle_scheduled = true;
	const run = (/** @type {IdleDeadline | undefined} */ deadline) => {
		idle_scheduled = false;
		while (unpacked.length > KEEP_UNPACKED) {
			const oldest = unpacked.find((other) => other !== current_history_node);
			if (!oldest) { break; }
			pack(oldest);
			if (deadline && deadline.timeRemaining() < 8) { break; }
		}
		schedule_idle_packing();
	};
	if (typeof requestIdleCallback === "function") {
		requestIdleCallback(run, { timeout: 2000 });
	} else {
		setTimeout(run, 200);
	}
}

/** @param {object} node */
function pack(node) {
	const index = unpacked.indexOf(node);
	if (index !== -1) { unpacked.splice(index, 1); }
	const store = storage_of.get(node);
	if (!store || !store.raw) { return; }
	const bytes = new Uint8Array(store.raw.data.buffer, store.raw.data.byteOffset, store.raw.data.byteLength);
	if (bytes.byteLength < MIN_PACK_BYTES || typeof pako === "undefined") { return; }
	store.packed = pako.deflate(bytes, { level: 1 });
	store.raw = null;
}

/** @param {Storage} store */
function unpack(store) {
	const bytes = pako.inflate(/** @type {Uint8Array} */ (store.packed));
	const raw = new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength), store.width, store.height, store.colorSpace ? { colorSpace: store.colorSpace } : undefined);
	for (const patch of store.pending) { apply_patch(raw, patch); }
	store.pending = [];
	store.packed = null;
	store.raw = raw;
	return raw;
}

/**
 * @param {ImageData} image_data
 * @param {{ x: number, y: number, width: number, height: number, data: Uint8ClampedArray }} patch
 */
function apply_patch(image_data, { x, y, width, height, data }) {
	for (let row = 0; row < height; row++) {
		image_data.data.set(data.subarray(row * width * 4, (row + 1) * width * 4), ((y + row) * image_data.width + x) * 4);
	}
}

/**
 * Gives a history node an `image_data` property backed by this storage. Called by make_history_node().
 * @template {object} T
 * @param {T} node
 * @param {ImageData | null} image_data
 * @returns {T}
 */
export function install_history_image_storage(node, image_data) {
	/** @type {Storage} */
	const store = { raw: null, packed: null, width: 0, height: 0, colorSpace: undefined, pending: [] };
	storage_of.set(node, store);
	Object.defineProperty(node, "image_data", {
		enumerable: true,
		configurable: true,
		get() {
			if (store.raw) {
				touch(node);
				return store.raw;
			}
			if (store.packed) {
				const raw = unpack(store);
				touch(node);
				return raw;
			}
			return null;
		},
		set(value) {
			const index = unpacked.indexOf(node);
			if (index !== -1) { unpacked.splice(index, 1); }
			store.packed = null;
			store.pending = [];
			store.raw = value || null;
			store.width = value ? value.width : 0;
			store.height = value ? value.height : 0;
			store.colorSpace = value ? value.colorSpace : undefined;
			if (value) { touch(node); }
		},
	});
	if (image_data) {
		/** @type {any} */ (node).image_data = image_data;
	}
	return node;
}

/**
 * The size of a history node's picture, without unpacking it.
 * @param {object} node
 * @returns {{ width: number, height: number } | null}
 */
export function history_image_size(node) {
	const store = storage_of.get(node);
	if (store) {
		return store.raw || store.packed ? { width: store.width, height: store.height } : null;
	}
	const image_data = /** @type {any} */ (node).image_data;
	return image_data ? { width: image_data.width, height: image_data.height } : null;
}

/**
 * Overwrites a rectangle of a history node's picture (live editing: someone else's change is the truth for that
 * rectangle in every step). A packed step gets it when it's next unpacked.
 * @param {object} node
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {Uint8ClampedArray} data - RGBA, width × height
 */
export function patch_history_image_data(node, x, y, width, height, data) {
	const store = storage_of.get(node);
	const patch = { x, y, width, height, data };
	if (store && store.packed) {
		store.pending.push(patch);
		return;
	}
	const image_data = /** @type {any} */ (node).image_data;
	if (image_data) { apply_patch(image_data, patch); }
}

/**
 * For tests and the console: how many of these history nodes are packed, and how big they are.
 * @param {object[]} nodes
 */
export function history_storage_stats(nodes) {
	let packed = 0, packed_bytes = 0, unpacked_bytes = 0;
	for (const node of nodes) {
		const store = storage_of.get(node);
		if (store?.packed) { packed++; packed_bytes += store.packed.byteLength; }
		if (store?.raw) { unpacked_bytes += store.raw.data.byteLength; }
	}
	return { nodes: nodes.length, unpacked: unpacked.length, packed, packed_bytes, unpacked_bytes };
}
