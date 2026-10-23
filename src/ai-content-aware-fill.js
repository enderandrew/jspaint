// @ts-check
/* global $status_text, main_canvas, main_ctx, selection */

// AI > Content-Aware Fill: a parody of the photo editor feature that removes things from pictures.
// Select something, and it really is filled in from its surroundings (each pixel blends the colors just outside
// the selection)... and then the paperclip assistant (images/clippy.jpg) moves into the space, to help.
// It's one undoable step, and a free-form selection keeps its shape.

import { show_error_message } from "./functions.js";
import { get_help_folder_icon, make_canvas } from "./helpers.js";
import { apply_image_transformation } from "./image-manipulation.js";
import { showMessageBox } from "./msgbox.js";

const HELPER_PATH = "images/clippy.jpg";

/** @type {Promise<HTMLCanvasElement & { ctx: CanvasRenderingContext2D }> | null} */
let helper_promise = null;

/** Loads the helper image, with its white background made transparent. */
function load_helper() {
	helper_promise ??= new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(cut_out_background(img));
		img.onerror = () => reject(new Error(`Couldn't load ${HELPER_PATH}`));
		img.src = HELPER_PATH;
	});
	helper_promise.catch(() => { helper_promise = null; }); // try again next time (maybe the file gets added)
	return helper_promise;
}

/**
 * Makes the white (or nearly white) background around a picture transparent: a flood fill from the edges,
 * so white areas inside the picture (like eyes) stay. JPEG noise is tolerated, and the outline is softened.
 * @param {HTMLImageElement} img
 */
function cut_out_background(img) {
	const canvas = make_canvas(img.naturalWidth, img.naturalHeight);
	canvas.ctx.drawImage(img, 0, 0);
	const { width, height } = canvas;
	const image_data = canvas.ctx.getImageData(0, 0, width, height);
	const d = image_data.data;
	const near_white = (/** @type {number} */ p) => d[p * 4] > 225 && d[p * 4 + 1] > 225 && d[p * 4 + 2] > 225;
	const background = new Uint8Array(width * height);
	const stack = [];
	for (let x = 0; x < width; x++) { stack.push(x, (height - 1) * width + x); }
	for (let y = 0; y < height; y++) { stack.push(y * width, y * width + width - 1); }
	while (stack.length) {
		const p = /** @type {number} */ (stack.pop());
		if (background[p] || !near_white(p)) { continue; }
		background[p] = 1;
		const x = p % width;
		if (x > 0) { stack.push(p - 1); }
		if (x < width - 1) { stack.push(p + 1); }
		if (p >= width) { stack.push(p - width); }
		if (p < width * (height - 1)) { stack.push(p + width); }
	}
	for (let p = 0; p < width * height; p++) {
		if (background[p]) {
			d[p * 4 + 3] = 0;
			continue;
		}
		// soften the outline: light pixels next to the background are partly transparent
		const x = p % width;
		const next_to_background = (x > 0 && background[p - 1]) || (x < width - 1 && background[p + 1]) ||
			(p >= width && background[p - width]) || (p < width * (height - 1) && background[p + width]);
		if (next_to_background) {
			const lightness = (d[p * 4] + d[p * 4 + 1] + d[p * 4 + 2]) / 3;
			d[p * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0.25, (255 - lightness) / 80)));
		}
	}
	canvas.ctx.putImageData(image_data, 0, 0);
	return canvas;
}

/**
 * Fills a canvas the size of the selection from the pixels just outside the selection on the main canvas:
 * every pixel blends the nearest outside colors across and down, weighted toward the closer edges.
 * @param {CanvasRenderingContext2D} target_ctx
 * @param {{ x: number, y: number, width: number, height: number }} region where the selection is, in canvas coordinates
 */
export function fill_from_surroundings(target_ctx, region) {
	const width = target_ctx.canvas.width;
	const height = target_ctx.canvas.height;
	const canvas_data = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height).data;
	const x0 = Math.round(region.x);
	const y0 = Math.round(region.y);
	const x1 = x0 + Math.round(region.width); // just past the right edge
	const y1 = y0 + Math.round(region.height); // just below the bottom edge

	/** The colors along one side, or null if that side is off the canvas. */
	const strip = (/** @type {number} */ length, /** @type {(i: number) => [number, number]} */ at) => {
		const colors = new Float32Array(length * 3);
		for (let i = 0; i < length; i++) {
			const [cx, cy] = at(i);
			if (cx < 0 || cy < 0 || cx >= main_canvas.width || cy >= main_canvas.height) { return null; }
			const p = (cy * main_canvas.width + cx) * 4;
			const a = canvas_data[p + 3] / 255; // transparent areas count as white
			colors[i * 3] = canvas_data[p] * a + 255 * (1 - a);
			colors[i * 3 + 1] = canvas_data[p + 1] * a + 255 * (1 - a);
			colors[i * 3 + 2] = canvas_data[p + 2] * a + 255 * (1 - a);
		}
		return colors;
	};
	const column = (/** @type {number} */ i) => x0 + Math.min(region.width - 1, Math.floor(i * region.width / width));
	const row = (/** @type {number} */ j) => y0 + Math.min(region.height - 1, Math.floor(j * region.height / height));
	let top = strip(width, (i) => [column(i), y0 - 1]);
	let bottom = strip(width, (i) => [column(i), y1]);
	let left = strip(height, (j) => [x0 - 1, row(j)]);
	let right = strip(height, (j) => [x1, row(j)]);
	// a side off the canvas borrows from the opposite side
	top ??= bottom;
	bottom ??= top;
	left ??= right;
	right ??= left;
	const white = (/** @type {number} */ length) => new Float32Array(length * 3).fill(255);
	if (!top && !left) { // the whole canvas is selected: nothing to go on
		top = bottom = white(width);
		left = right = white(height);
	} else if (!top || !bottom) {
		top = bottom = null;
	} else if (!left || !right) {
		left = right = null;
	}

	const image_data = target_ctx.createImageData(width, height);
	const d = image_data.data;
	for (let j = 0; j < height; j++) {
		const v = (j + 0.5) / height;
		for (let i = 0; i < width; i++) {
			const u = (i + 0.5) / width;
			// weight each direction by how close its nearer edge is
			const weight_across = left ? 1 / (Math.min(u, 1 - u) + 0.02) ** 2 : 0;
			const weight_down = top ? 1 / (Math.min(v, 1 - v) + 0.02) ** 2 : 0;
			const total = weight_across + weight_down;
			const noise = (Math.random() - 0.5) * 6; // a little texture, so it doesn't look airbrushed
			for (let c = 0; c < 3; c++) {
				let value = 0;
				if (left && right) { value += weight_across * (left[j * 3 + c] * (1 - u) + right[j * 3 + c] * u); }
				if (top && bottom) { value += weight_down * (top[i * 3 + c] * (1 - v) + bottom[i * 3 + c] * v); }
				d[(j * width + i) * 4 + c] = value / total + noise;
			}
			d[(j * width + i) * 4 + 3] = 255;
		}
	}
	target_ctx.putImageData(image_data, 0, 0);
}

/**
 * Draws the helper in the middle of the canvas, as big as fits comfortably.
 * @param {CanvasRenderingContext2D} target_ctx
 * @param {HTMLCanvasElement} helper
 */
function draw_helper(target_ctx, helper) {
	const { width, height } = target_ctx.canvas;
	const scale = Math.min(width * 0.8 / helper.width, height * 0.85 / helper.height);
	const draw_width = helper.width * scale;
	const draw_height = helper.height * scale;
	target_ctx.save();
	target_ctx.imageSmoothingEnabled = true;
	target_ctx.imageSmoothingQuality = "high";
	target_ctx.drawImage(helper, (width - draw_width) / 2, (height - draw_height) / 2, draw_width, draw_height);
	target_ctx.restore();
}

export async function content_aware_fill() {
	if (!selection) {
		showMessageBox({
			title: "Content-Aware Fill",
			iconID: "info",
			message: "It looks like you're trying to remove something from your picture.\n\nSelect the part you want removed first, then choose Content-Aware Fill.",
		});
		return;
	}
	let helper;
	try {
		helper = await load_helper();
	} catch (error) {
		show_error_message(`Content-Aware Fill couldn't find its assistant. Add an image named ${HELPER_PATH}.`, error);
		return;
	}
	const answer = await showMessageBox({
		title: "Content-Aware Fill",
		iconID: "info",
		message: "It looks like you're trying to remove something from your picture.\n\nWould you like help?",
		buttons: [
			{ label: "Yes, fill it in", value: "yes", default: true },
			{ label: "No, but fill it in anyway", value: "no" },
		],
	});
	if (answer !== "yes" && answer !== "no") { return; } // closed
	if (!selection) { return; } // deselected in the meantime

	const region = { x: selection.x, y: selection.y, width: selection.width, height: selection.height };
	apply_image_transformation({
		name: "Content-Aware Fill",
		icon: get_help_folder_icon("p_paste.png"),
	}, (original_canvas, _original_ctx, _new_canvas, new_ctx) => {
		fill_from_surroundings(new_ctx, region);
		draw_helper(new_ctx, helper);
		// keep the shape of a free-form selection
		new_ctx.save();
		new_ctx.globalCompositeOperation = "destination-in";
		new_ctx.drawImage(original_canvas, 0, 0);
		new_ctx.restore();
	});
	$status_text.text("📎 Content-Aware Fill: I removed that for you, and moved in. Anything else I can help with?");
}
