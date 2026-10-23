// @ts-check
/* global $status_text, root_history_node */

// AI > Enhance!: a parody "AI upscaler", like "zoom... enhance!" in crime dramas.
// After a convincing progress dialog, it pixelates the picture (or the selection), and every Enhance
// on the same document makes the blocks bigger, while the status bar boasts about all the "detail" it added.
// It's one undoable step, so Undo brings the picture back.

import { $DialogWindow } from "./$ToolWindow.js";
import { E, get_help_folder_icon } from "./helpers.js";
import { apply_image_transformation } from "./image-manipulation.js";

const STEPS = [
	"Loading neural network...",
	"Counting pixels...",
	"Hallucinating details...",
	"Adding more pixels...",
	"Removing the extra pixels...",
	"Consulting a crime drama...",
	"Zoom... Enhance!",
];
const ETAS = ["3 seconds", "2 hours", "45 minutes", "1 second", "Calculating...", "Almost there", "0 seconds"];
const DURATION = 2600; // ms of very serious computation

let enhance_count = 0;
/** @type {object | null} */
let enhanced_document = null;
let busy = false;

/** The block size for the next Enhance: 4px, then 8, 16, 32, 64 on the same document. */
function next_block_size() {
	if (enhanced_document !== root_history_node) {
		enhanced_document = root_history_node;
		enhance_count = 0;
	}
	return Math.min(64, 4 * 2 ** enhance_count);
}

/**
 * Pixelates `source` into `target` in square blocks (each block is the average of its pixels),
 * with a little extra saturation and contrast for that "AI-enhanced" look.
 * @param {HTMLCanvasElement} source
 * @param {CanvasRenderingContext2D} target_ctx
 * @param {number} block
 */
export function pixelate(source, target_ctx, block) {
	const small_width = Math.max(1, Math.ceil(source.width / block));
	const small_height = Math.max(1, Math.ceil(source.height / block));
	const small = /** @type {HTMLCanvasElement} */ (E("canvas"));
	small.width = small_width;
	small.height = small_height;
	const small_ctx = /** @type {CanvasRenderingContext2D} */ (small.getContext("2d"));
	small_ctx.imageSmoothingEnabled = true;
	small_ctx.imageSmoothingQuality = "high";
	small_ctx.drawImage(source, 0, 0, small_width * block, small_height * block, 0, 0, small_width, small_height);

	target_ctx.save();
	target_ctx.imageSmoothingEnabled = false;
	target_ctx.filter = "saturate(1.25) contrast(1.1)"; // ignored by browsers without canvas filters
	target_ctx.drawImage(small, 0, 0, small_width * block, small_height * block);
	target_ctx.restore();
}

export function show_enhance_dialog() {
	if (busy) { return; }
	busy = true;

	const $w = $DialogWindow("AI Upscale");
	$w.addClass("ai-enhance-window");
	const $step = $(E("p")).text(STEPS[0]).appendTo($w.$main);
	const $progress = $(E("progress")).attr({ max: 100, value: 0 }).appendTo($w.$main);
	const $eta = $(E("p")).text(`Estimated time remaining: ${ETAS[0]}`).appendTo($w.$main);
	let canceled = false;
	$w.$Button("Cancel", () => {
		canceled = true;
		$w.close();
	});
	$w.on("close", () => {
		canceled = true;
		busy = false;
	});
	$w.center();

	const started = performance.now();
	const tick = () => {
		if (canceled) { return; }
		const t = Math.min(1, (performance.now() - started) / DURATION);
		// a progress bar that, like all progress bars, is mostly made up
		const shown = t < 0.9 ? Math.round(100 * Math.sqrt(t) * 0.94) : Math.round(100 * t);
		$progress.attr("value", shown);
		const step = Math.min(STEPS.length - 1, Math.floor(t * STEPS.length));
		$step.text(STEPS[step]);
		$eta.text(`Estimated time remaining: ${ETAS[step]}`);
		if (t < 1) {
			setTimeout(tick, 60);
			return;
		}
		$w.close();
		enhance();
	};
	tick();
}

/** Does the actual "enhancing". */
export function enhance() {
	const block = next_block_size();
	enhance_count++;
	apply_image_transformation({
		name: "Enhance!",
		icon: get_help_folder_icon("p_stretch_both.png"),
	}, (original_canvas, _original_ctx, _new_canvas, new_ctx) => {
		pixelate(original_canvas, new_ctx, block);
	});
	const detail = (block * block * 100).toLocaleString("en-US");
	$status_text.text(`✨ Enhanced! Now with ${detail}% more detail. Enhance again for even more.`);
}
