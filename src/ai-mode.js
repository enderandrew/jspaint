// @ts-check
/* global $canvas_area, $status_text, main_canvas, main_ctx, new_local_session, root_history_node, selected_colors */

// AI Mode: a parody "AI-assisted painting" feature.
//
// There is no AI. A painting (images/ai-1.jpg, ai-2.jpg, ...) is hidden under the canvas,
// and every tool that touches the canvas reveals it instead of painting:
// - The document starts transparent, shown as white (the "blank canvas").
// - All three color slots become "AI ink": a pattern of the hidden painting, lined up with the canvas,
//   so brushes, shapes, fills, the eraser and their live previews all draw the painting.
// - After every action, before it's recorded in the history, ai_mode_settle() makes each pixel either
//   still blank (transparent) or exactly the painting. That catches anything the ink doesn't cover,
//   like text, Invert Colors, or a color picked from the palette mid-session.
// Saving flattens onto white, so files never have holes.

import { are_you_sure, cancel, deselect, reset_canvas_and_history, reset_file, show_error_message, undoable, update_title } from "./functions.js";
import { $G, make_canvas } from "./helpers.js";
import { showMessageBox } from "./msgbox.js";

const SOURCE_PATH = (/** @type {number} */ n) => `images/ai-${n}.jpg`;
const MAX_SOURCES = 99;
const MAX_CANVAS_SIZE = 1600;

/** @type {string[] | null} */
let source_urls = null;
/** @type {string | null} */
let current_source_url = null;
/** @type {HTMLImageElement | null} */
let source_image = null;
/** @type {(HTMLCanvasElement & { ctx: CanvasRenderingContext2D }) | null} */
let source_canvas = null; // the painting fitted to the current canvas size
/** @type {ImageData | null} */
let source_data = null;
/** @type {CanvasPattern | null} */
let ai_ink = null;
/** @type {object | null} */
let ai_document = null; // the history root of the AI document; anything else means AI Mode is over
/** @type {{ foreground: string | CanvasPattern, background: string | CanvasPattern, ternary: string | CanvasPattern } | null} */
let colors_before = null;
let announced_complete = false;
let shown_intro = false;
let starting = false;

export function is_ai_mode_active() {
	return ai_document !== null;
}

// Opening or creating another document (File > New, Open, a session load) ends AI Mode right away,
// so the AI ink never gets painted onto a normal picture.
$G.on("history-update", () => {
	if (is_ai_mode_active() && !starting && root_history_node !== ai_document) {
		stop_ai_mode(false);
	}
});

/** Finds images/ai-1.jpg, ai-2.jpg, ... until one is missing. */
export async function find_sources() {
	if (source_urls) { return source_urls; }
	const found = [];
	for (let n = 1; n <= MAX_SOURCES; n++) {
		const url = SOURCE_PATH(n);
		const exists = await new Promise((resolve) => {
			const img = new Image();
			img.onload = () => resolve(true);
			img.onerror = () => resolve(false);
			img.src = url;
		});
		if (!exists) { break; }
		found.push(url);
	}
	source_urls = found;
	return found;
}

/** @param {string} url */
function load_image(url) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`Couldn't load ${url}`));
		img.src = url;
	});
}

/** Draws the painting to cover a canvas of the given size (centered, keeping its aspect ratio). */
function fit_source(width, height) {
	if (!source_image) { return; }
	if (source_canvas && source_canvas.width === width && source_canvas.height === height) { return; }
	source_canvas = make_canvas(width, height);
	const scale = Math.max(width / source_image.naturalWidth, height / source_image.naturalHeight);
	const draw_width = source_image.naturalWidth * scale;
	const draw_height = source_image.naturalHeight * scale;
	source_canvas.ctx.imageSmoothingEnabled = true;
	source_canvas.ctx.drawImage(source_image, (width - draw_width) / 2, (height - draw_height) / 2, draw_width, draw_height);
	source_data = source_canvas.ctx.getImageData(0, 0, width, height);
	ai_ink = main_ctx.createPattern(source_canvas, "repeat");
	if (is_ai_mode_active()) {
		use_ai_ink();
	}
}

function use_ai_ink() {
	selected_colors.foreground = ai_ink;
	selected_colors.background = ai_ink;
	selected_colors.ternary = ai_ink;
	$G.trigger("option-changed");
}

/**
 * Makes every pixel either still blank (transparent) or exactly the hidden painting.
 * Called by undoable() after an action runs and before the result goes into the history.
 */
export function ai_mode_settle() {
	if (!is_ai_mode_active()) { return; }
	if (root_history_node !== ai_document) {
		stop_ai_mode(false); // a different document was opened or created
		return;
	}
	fit_source(main_canvas.width, main_canvas.height);
	if (!source_data) { return; }

	const width = main_canvas.width;
	const height = main_canvas.height;
	const image_data = main_ctx.getImageData(0, 0, width, height);
	const pixels = image_data.data;
	const source = source_data.data;
	let painted = 0;
	let changed = false;
	for (let i = 0; i < pixels.length; i += 4) {
		if (pixels[i + 3] === 0) { continue; } // still blank
		painted++;
		if (
			pixels[i + 3] === 255 &&
			Math.abs(pixels[i] - source[i]) <= 2 &&
			Math.abs(pixels[i + 1] - source[i + 1]) <= 2 &&
			Math.abs(pixels[i + 2] - source[i + 2]) <= 2
		) {
			continue; // already the painting
		}
		pixels[i] = source[i];
		pixels[i + 1] = source[i + 1];
		pixels[i + 2] = source[i + 2];
		pixels[i + 3] = 255;
		changed = true;
	}
	if (changed) {
		main_ctx.putImageData(image_data, 0, 0);
	}
	show_progress(painted / (width * height));
}

/** @param {number} fraction */
function show_progress(fraction) {
	const percent = Math.floor(fraction * 100);
	const quips = [
		"Analyzing your brushstrokes...",
		"Enhancing your artistic vision...",
		"Consulting the Old Masters...",
		"Restoring fresco...",
		"Applying neural varnish...",
	];
	const quip = quips[Math.floor(Math.random() * quips.length)];
	$status_text.text(`✨ AI: ${quip} Masterpiece ${percent}% complete.`);
	if (fraction >= 0.995 && !announced_complete) {
		announced_complete = true;
		showMessageBox({
			title: "AI Mode",
			iconID: "info",
			message: "Masterpiece complete!\n\nOur AI has turned your brushstrokes into a priceless work of art. Any resemblance to existing paintings is purely algorithmic.",
		});
	}
}

/**
 * Starts a new AI document with one of the hidden paintings.
 * @param {{ different?: boolean }} [options] different: avoid the painting used last time
 */
export async function start_ai_mode({ different = false } = {}) {
	const urls = await find_sources();
	if (urls.length === 0) {
		show_error_message(`AI Mode couldn't find any paintings to "generate". Add images named ${SOURCE_PATH(1)}, ${SOURCE_PATH(2)}, and so on.`);
		return;
	}
	const choices = different && urls.length > 1 ? urls.filter((url) => url !== current_source_url) : urls;
	const url = choices[Math.floor(Math.random() * choices.length)];
	let img;
	try {
		img = await load_image(url);
	} catch (error) {
		show_error_message("AI Mode couldn't load its painting.", error);
		return;
	}

	are_you_sure(() => {
		starting = true;
		deselect();
		cancel();
		$G.triggerHandler("session-update"); // autosave the old document
		new_local_session();
		reset_file();

		if (!colors_before) {
			colors_before = { foreground: selected_colors.foreground, background: selected_colors.background, ternary: selected_colors.ternary };
		}
		$("body").addClass("ai-mode"); // before the canvas goes blank, so it isn't mistaken for data loss (sessions.js)
		reset_canvas_and_history();

		// Size the canvas to the painting (within reason), and make it blank (transparent, shown as white).
		const scale = Math.min(1, MAX_CANVAS_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
		main_canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
		main_canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
		main_ctx.disable_image_smoothing();
		main_ctx.clearRect(0, 0, main_canvas.width, main_canvas.height);
		root_history_node.image_data = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);
		root_history_node.name = "New AI Masterpiece";

		current_source_url = url;
		source_image = img;
		source_canvas = null;
		ai_document = root_history_node;
		announced_complete = false;
		fit_source(main_canvas.width, main_canvas.height);
		use_ai_ink();

		main_canvas.style.background = "#fff"; // the blank areas show as a white canvas, not a transparency checkerboard
		update_title();
		starting = false;
		$canvas_area.trigger("resize");
		$G.triggerHandler("history-update");
		$G.triggerHandler("session-update");
		$status_text.text("✨ AI Mode: just start painting. The AI will take it from there.");

		if (!shown_intro) {
			shown_intro = true;
			showMessageBox({
				title: "AI Mode",
				iconID: "info",
				message: "AI Mode is on.\n\nUse any tool and our state-of-the-art neural brush will turn your strokes into a masterpiece. No talent required!",
			});
		}
	});
}

/**
 * @param {boolean} [flatten] fill the still-blank areas with white (when the user turns AI Mode off)
 */
export function stop_ai_mode(flatten = true) {
	if (!is_ai_mode_active()) { return; }
	const document_still_ours = root_history_node === ai_document;
	ai_document = null;
	main_canvas.style.background = "";
	$("body").removeClass("ai-mode");
	if (colors_before) {
		selected_colors.foreground = colors_before.foreground;
		selected_colors.background = colors_before.background;
		selected_colors.ternary = colors_before.ternary;
		colors_before = null;
		$G.trigger("option-changed");
	}
	if (flatten && document_still_ours) {
		undoable({ name: "Exit AI Mode" }, () => {
			main_ctx.save();
			main_ctx.globalCompositeOperation = "destination-over";
			main_ctx.fillStyle = "#fff";
			main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);
			main_ctx.restore();
		});
	}
	$status_text.default();
}

export function toggle_ai_mode() {
	if (is_ai_mode_active()) {
		stop_ai_mode();
	} else {
		start_ai_mode();
	}
}

/**
 * The canvas to encode when saving: in AI Mode, a copy flattened onto white, so the blank areas aren't holes.
 * @param {HTMLCanvasElement} canvas
 * @returns {HTMLCanvasElement}
 */
export function ai_mode_canvas_for_saving(canvas) {
	if (!is_ai_mode_active() || canvas !== main_canvas) { return canvas; }
	const flat = make_canvas(canvas.width, canvas.height);
	flat.ctx.fillStyle = "#fff";
	flat.ctx.fillRect(0, 0, flat.width, flat.height);
	flat.ctx.drawImage(canvas, 0, 0);
	return flat;
}
