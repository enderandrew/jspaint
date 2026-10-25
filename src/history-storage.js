// @ts-check
/* global current_history_node, pako */

// Undo history memory. Each step used to keep a whole picture: about 1.8 MB per step at 800×600 (60 strokes:
// 110 MB), and several times that for a long web page.
//
// Now a step keeps only what it changed. When a step is made, the rectangle that differs from the step before it
// (its parent) is noted; once the step hasn't been used lately, it's packed down to just that rectangle's pixels,
// compressed with pako's deflate, and its picture is rebuilt from its parent's when it's needed again. A stroke
// costs a few kilobytes of history however big the page is, photos included.
//  - Only the few steps used most recently (always including the current one) keep their whole picture unpacked.
//  - Every KEYFRAME_EVERY steps along a branch, and wherever the size changes, a step is packed whole (deflated),
//    so rebuilding a picture never has to go back more than that many steps.
//  - Nothing else has to change: `node.image_data` is a property that rebuilds the step when it's read (and keeps
//    it until it's the least recently used again).
//  - Packing happens when the browser is idle, for steps past the first few; a loop that reads many steps
//    (an animated GIF of the history, say) packs synchronously past a hard limit, so memory stays bounded there too.
//  - Live editing changes a rectangle of every step at once: patch_history_image_data() queues it on packed steps,
//    to be applied when they're rebuilt, instead of unpacking them all. (Every step gets the same patch, so a step
//    rebuilt from its parent is still right.)
//  - A step whose picture is replaced outright (setting `image_data` again) first turns the steps built on it into
//    whole pictures, so they don't change with it.

/** Steps whose pixels stay unpacked when the browser has a moment. */
const KEEP_UNPACKED = 4;
/** Past this many, the least recently used steps are packed right away. */
const MAX_UNPACKED = 12;
/** Whole pictures smaller than this aren't worth packing (bytes of RGBA). */
const MIN_PACK_BYTES = 64 * 1024;
/** A step is kept whole at least this often along a branch, to bound how far back a rebuild goes. */
const KEYFRAME_EVERY = 16;

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{
 *   raw: ImageData | null,
 *   packed: Uint8Array | null,
 *   width: number,
 *   height: number,
 *   colorSpace: PredefinedColorSpace | undefined,
 *   pending: { x: number, y: number, width: number, height: number, data: Uint8ClampedArray }[],
 *   base: object | null,
 *   rect: Rect | null,
 *   depth: number,
 *   dependents: Set<object>,
 * }} Storage
 * `base` is the step this one's picture is its parent's plus `rect` (`packed` then holds just that rectangle);
 * without a base, `packed` holds the whole picture.
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

/**
 * The rectangle where two pictures of the same size differ (width 0 when they don't).
 * @param {ImageData} before
 * @param {ImageData} after
 * @returns {Rect}
 */
function changed_rect(before, after) {
	const { width, height } = after;
	const a = new Uint32Array(before.data.buffer, before.data.byteOffset, width * height);
	const b = new Uint32Array(after.data.buffer, after.data.byteOffset, width * height);
	let top = -1, bottom = -1, left = width, right = -1;
	for (let y = 0; y < height; y++) {
		const row = y * width;
		let first = -1, last = -1;
		for (let x = 0; x < width; x++) {
			if (a[row + x] !== b[row + x]) { first = x; break; }
		}
		if (first === -1) { continue; }
		for (let x = width - 1; x >= first; x--) {
			if (a[row + x] !== b[row + x]) { last = x; break; }
		}
		if (top === -1) { top = y; }
		bottom = y;
		left = Math.min(left, first);
		right = Math.max(right, last);
	}
	if (top === -1) { return { x: 0, y: 0, width: 0, height: 0 }; }
	return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * A rectangle of a picture's pixels.
 * @param {ImageData} image_data
 * @param {Rect} rect
 */
function crop(image_data, { x, y, width, height }) {
	const out = new Uint8Array(width * height * 4);
	for (let row = 0; row < height; row++) {
		const start = ((y + row) * image_data.width + x) * 4;
		out.set(image_data.data.subarray(start, start + width * 4), row * width * 4);
	}
	return out;
}

/** @param {Rect} a @param {Rect} b @returns {Rect} */
function union(a, b) {
	if (!a.width || !a.height) { return { ...b }; }
	if (!b.width || !b.height) { return { ...a }; }
	const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
	return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** Stops being built on another step. @param {object} node @param {Storage} store */
function drop_base(node, store) {
	if (store.base) { storage_of.get(store.base)?.dependents.delete(node); }
	store.base = null;
	store.rect = null;
	store.depth = 0;
}

/** @param {object} node */
function pack(node) {
	const index = unpacked.indexOf(node);
	if (index !== -1) { unpacked.splice(index, 1); }
	const store = storage_of.get(node);
	if (!store || !store.raw || typeof pako === "undefined") { return; }
	if (store.base && store.rect) {
		// Just what this step changed
		store.packed = pako.deflate(crop(store.raw, store.rect), { level: 1 });
		store.raw = null;
		return;
	}
	const bytes = new Uint8Array(store.raw.data.buffer, store.raw.data.byteOffset, store.raw.data.byteLength);
	if (bytes.byteLength < MIN_PACK_BYTES) { return; }
	store.packed = pako.deflate(bytes, { level: 1 });
	store.raw = null;
}

/**
 * @param {ImageData} image_data
 * @param {{ x: number, y: number, width: number, height: number, data: Uint8ClampedArray | Uint8Array }} patch
 */
function apply_patch(image_data, { x, y, width, height, data }) {
	for (let row = 0; row < height; row++) {
		image_data.data.set(data.subarray(row * width * 4, (row + 1) * width * 4), ((y + row) * image_data.width + x) * 4);
	}
}

/**
 * A step's picture, rebuilt if it's packed, without keeping anything it was rebuilt from.
 * `owned` says whether it's a fresh copy (free to change) rather than a step's own unpacked picture.
 * @param {object} node
 * @returns {{ image_data: ImageData, owned: boolean } | null}
 */
function pixels_of(node) {
	const store = storage_of.get(node);
	if (!store) {
		const image_data = /** @type {any} */ (node).image_data;
		return image_data ? { image_data, owned: false } : null;
	}
	if (store.raw) { return { image_data: store.raw, owned: false }; }
	if (!store.packed) { return null; }
	const settings = store.colorSpace ? { colorSpace: store.colorSpace } : undefined;
	let image_data;
	if (store.base && store.rect) {
		const from = pixels_of(store.base);
		if (!from) { throw new Error("history-storage: a step's picture is missing the step it's built on"); }
		image_data = from.owned ? from.image_data : new ImageData(new Uint8ClampedArray(from.image_data.data), store.width, store.height, settings);
		if (store.rect.width && store.rect.height) {
			apply_patch(image_data, { ...store.rect, data: pako.inflate(store.packed) });
		}
	} else {
		const bytes = pako.inflate(store.packed);
		image_data = new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength), store.width, store.height, settings);
	}
	for (const patch of store.pending) { apply_patch(image_data, patch); }
	return { image_data, owned: true };
}

/**
 * Turns the steps built on this one into whole pictures (its own picture is about to be replaced).
 * @param {Storage} store
 */
function detach_dependents(store) {
	for (const dependent of [...store.dependents]) {
		const dependent_store = storage_of.get(dependent);
		if (!dependent_store) { continue; }
		if (dependent_store.packed && !dependent_store.raw) {
			const rebuilt = /** @type {{ image_data: ImageData }} */ (pixels_of(dependent));
			dependent_store.pending = [];
			const bytes = new Uint8Array(rebuilt.image_data.data.buffer, rebuilt.image_data.data.byteOffset, rebuilt.image_data.data.byteLength);
			dependent_store.packed = pako.deflate(bytes, { level: 1 });
		}
		drop_base(dependent, dependent_store);
	}
	store.dependents.clear();
}

/**
 * Notes what a step changed from its parent, if its parent's picture is at hand (it is, for a step just made).
 * @param {any} node
 * @param {Storage} store
 */
function note_change_from_parent(node, store) {
	const parent = node.parent;
	const parent_store = parent && storage_of.get(parent);
	if (!store.raw || !parent_store || !parent_store.raw) { return; }
	if (parent_store.width !== store.width || parent_store.height !== store.height || parent_store.colorSpace !== store.colorSpace) { return; }
	const depth = (parent_store.base ? parent_store.depth : 0) + 1;
	if (depth >= KEYFRAME_EVERY) { return; }
	store.base = parent;
	store.rect = changed_rect(parent_store.raw, store.raw);
	store.depth = depth;
	parent_store.dependents.add(node);
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
	const store = { raw: null, packed: null, width: 0, height: 0, colorSpace: undefined, pending: [], base: null, rect: null, depth: 0, dependents: new Set() };
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
				const rebuilt = /** @type {{ image_data: ImageData }} */ (pixels_of(node));
				store.raw = rebuilt.image_data;
				store.packed = null;
				store.pending = [];
				touch(node);
				return store.raw;
			}
			return null;
		},
		set(value) {
			if (store.dependents.size) { detach_dependents(store); }
			drop_base(node, store);
			const index = unpacked.indexOf(node);
			if (index !== -1) { unpacked.splice(index, 1); }
			store.packed = null;
			store.pending = [];
			store.raw = value || null;
			store.width = value ? value.width : 0;
			store.height = value ? value.height : 0;
			store.colorSpace = value ? value.colorSpace : undefined;
			if (value) {
				note_change_from_parent(node, store);
				touch(node);
			}
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
	// (an unpacked step built on its parent keeps the patched rectangle itself, in case its parent isn't patched)
	if (store && store.base && store.rect) { store.rect = union(store.rect, { x, y, width, height }); }
}

/**
 * For tests and the console: how many of these history nodes are packed, and how big they are.
 * `deltas` counts the packed steps holding only what they changed.
 * @param {object[]} nodes
 */
export function history_storage_stats(nodes) {
	let packed = 0, packed_bytes = 0, unpacked_bytes = 0, deltas = 0;
	for (const node of nodes) {
		const store = storage_of.get(node);
		if (store?.packed) {
			packed++;
			packed_bytes += store.packed.byteLength;
			if (store.base) { deltas++; }
		}
		if (store?.raw) { unpacked_bytes += store.raw.data.byteLength; }
	}
	return { nodes: nodes.length, unpacked: unpacked.length, packed, deltas, packed_bytes, unpacked_bytes };
}
