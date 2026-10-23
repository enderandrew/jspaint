// @ts-check
/* global $status_text, main_canvas, selection */

// AI > Prompt...: a parody of AI image generators. Describe the image you want, press Generate,
// watch it "diffuse" in the preview, and get... one of AI Mode's paintings (images/ai-1.jpg, ...), whatever you asked for.
// The same prompt always gives the same picture (it's "seeded" by the prompt). It's one undoable step, and it fills
// the selection if there is one. Ask for a paperclip and you get the assistant (images/clippy.jpg).
// With no paintings at all, it draws exactly what you asked for: the words.

import { $DialogWindow } from "./$ToolWindow.js";
import { find_sources } from "./ai-mode.js";
import { E, get_help_folder_icon, make_canvas } from "./helpers.js";
import { apply_image_transformation } from "./image-manipulation.js";

const PREVIEW_SIZE = 180;
const DURATION = 3000;
const PAPERCLIP = /\b(clippy|paper ?clips?|office assistant)\b/i;

/** @type {(OSGUI$Window & I$DialogWindow) | null} */
let $prompt_window = null;
let busy = false;

/** A number from the prompt text, so the same prompt gives the same picture. */
function seed_from(/** @type {string} */ text) {
	let hash = 2166136261;
	for (const char of text.trim().toLowerCase()) {
		hash ^= /** @type {number} */ (char.codePointAt(0));
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash;
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

/**
 * Picks the "generated" image for a prompt: the assistant for paperclips, otherwise a painting chosen by the prompt,
 * or null if there are no paintings (then the prompt is drawn as text).
 * @param {string} prompt
 * @returns {Promise<HTMLImageElement | null>}
 */
async function pick_image(prompt) {
	if (PAPERCLIP.test(prompt)) {
		try {
			return await load_image("images/clippy.jpg");
		} catch {
			// no assistant; fall back to a painting
		}
	}
	const urls = await find_sources();
	if (urls.length === 0) { return null; }
	try {
		return await load_image(urls[seed_from(prompt) % urls.length]);
	} catch {
		return null;
	}
}

/**
 * Draws the result into a canvas: the image covering it (centered, cropped to fit), or the prompt as text.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement | null} img
 * @param {string} prompt
 */
export function draw_generated(ctx, img, prompt) {
	const { width, height } = ctx.canvas;
	ctx.save();
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, width, height);
	if (img) {
		const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		ctx.drawImage(img, (width - img.naturalWidth * scale) / 2, (height - img.naturalHeight * scale) / 2, img.naturalWidth * scale, img.naturalHeight * scale);
	} else {
		// "We drew exactly what you asked for."
		ctx.fillStyle = "#000";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		const words = prompt.trim().split(/\s+/);
		let size = Math.max(8, Math.floor(height / 3));
		let lines = [];
		for (; size >= 8; size = Math.floor(size * 0.9)) {
			ctx.font = `bold ${size}px "Comic Sans MS", "Comic Neue", cursive, sans-serif`;
			lines = [];
			let line = "";
			for (const word of words) {
				const next = line ? `${line} ${word}` : word;
				if (line && ctx.measureText(next).width > width * 0.9) {
					lines.push(line);
					line = word;
				} else {
					line = next;
				}
			}
			lines.push(line);
			if (lines.length * size * 1.2 <= height * 0.9 && lines.every((l) => ctx.measureText(l).width <= width * 0.9)) { break; }
		}
		lines.forEach((l, i) => ctx.fillText(l, width / 2, height / 2 + (i - (lines.length - 1) / 2) * size * 1.2));
	}
	ctx.restore();
}

/** What the AI has to say about the result. */
function caption_for(/** @type {string} */ prompt, /** @type {HTMLImageElement | null} */ img) {
	const quoted = `"${prompt.length > 40 ? `${prompt.slice(0, 40).trim()}...` : prompt}"`;
	if (!img) {
		return `Here's ${quoted}. We drew exactly what you asked for.`;
	}
	if (PAPERCLIP.test(prompt)) {
		return "It looks like you're trying to generate an image. Would you like help?";
	}
	const buzzword = prompt.match(/\b(4k|8k|hd|ultra[- ]?realistic|highly detailed|best quality|masterpiece|trending on artstation|award[- ]winning|octane render|unreal engine)\b/i);
	if (buzzword) {
		return `Here's ${quoted}. Adding "${buzzword[0]}" improved the result by 0%.`;
	}
	if (/\bin the style of\b/i.test(prompt)) {
		return `Here's ${quoted}. Style noted, and ignored.`;
	}
	if (/\b(hands?|fingers?)\b/i.test(prompt)) {
		return `Here's ${quoted}. Please don't count the fingers.`;
	}
	const quips = [
		`Here's ${quoted}. The AI took some creative liberties.`,
		`Here's ${quoted}, as imagined by someone who has never heard of it.`,
		`Here's ${quoted}. Any resemblance to existing artwork is purely algorithmic.`,
		`Prompt understood. Mostly. Here's ${quoted}.`,
	];
	return quips[seed_from(prompt) % quips.length];
}

/**
 * Animates the image appearing in the preview: noise, then brush strokes of the picture, then all of it.
 * @param {HTMLCanvasElement & { ctx: CanvasRenderingContext2D }} preview
 * @param {HTMLCanvasElement} result
 * @param {(t: number) => void} on_progress
 * @returns {Promise<boolean>} false if canceled (the window closed)
 */
function animate_preview(preview, result, on_progress) {
	const ctx = preview.ctx;
	const pattern = ctx.createPattern(result, "no-repeat");
	const noise = ctx.createImageData(preview.width, preview.height);
	for (let i = 0; i < noise.data.length; i += 4) {
		const gray = Math.random() * 255;
		noise.data.set([gray, gray * 0.9 + Math.random() * 25, gray * 0.8 + Math.random() * 50, 255], i);
	}
	ctx.putImageData(noise, 0, 0);
	const started = performance.now();
	return new Promise((resolve) => {
		const tick = () => {
			if (!$prompt_window || $prompt_window.closed) {
				resolve(false);
				return;
			}
			const t = Math.min(1, (performance.now() - started) / DURATION);
			on_progress(t);
			if (t >= 1) {
				ctx.drawImage(result, 0, 0);
				resolve(true);
				return;
			}
			// "denoising": strokes of the picture, getting smaller and more numerous
			ctx.save();
			ctx.strokeStyle = /** @type {CanvasPattern} */ (pattern);
			ctx.lineCap = "round";
			ctx.lineWidth = Math.max(1.5, 10 * (1 - t));
			for (let i = 0; i < 2 + t * 10; i++) {
				const x = Math.random() * preview.width;
				const y = Math.random() * preview.height;
				const angle = Math.random() * Math.PI * 2;
				const length = 4 + Math.random() * 12;
				ctx.beginPath();
				ctx.moveTo(x, y);
				ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
				ctx.stroke();
			}
			ctx.restore();
			setTimeout(tick, 40);
		};
		tick();
	});
}

/**
 * Generates an image for the prompt and puts it on the canvas (or in the selection).
 * @param {string} prompt
 */
async function generate(prompt) {
	if (!$prompt_window) { return; }
	const $w = $prompt_window;
	const $status = $w.$main.find(".ai-prompt-status");
	prompt = prompt.trim();
	if (!prompt) {
		$status.text("Please describe the image you want. Our AI can't read minds. Yet.");
		return;
	}
	if (busy) { return; }
	busy = true;
	const $generate = $w.$buttons.find(".ai-prompt-generate").prop("disabled", true);
	const $preview = $w.$main.find(".ai-prompt-preview");
	try {
		const img = await pick_image(prompt);

		// the preview has the shape of what it's going to fill
		const target = selection ? selection.source_canvas : null;
		const target_width = target ? target.width : main_canvas.width;
		const target_height = target ? target.height : main_canvas.height;
		const scale = PREVIEW_SIZE / Math.max(target_width, target_height);
		const preview = make_canvas(Math.max(1, Math.round(target_width * scale)), Math.max(1, Math.round(target_height * scale)));
		const small_result = make_canvas(preview.width, preview.height);
		draw_generated(small_result.ctx, img, prompt);
		$preview.empty().append(preview).show();

		const steps = 50;
		const finished = await animate_preview(preview, small_result, (t) => {
			const step = Math.min(steps, Math.floor(t * steps) + 1);
			$status.text(t < 1 ? `Denoising... step ${step} of ${steps}` : "Done!");
		});
		if (!finished) { return; }

		apply_image_transformation({
			name: `Generate "${prompt.length > 30 ? `${prompt.slice(0, 30).trim()}...` : prompt}"`,
			icon: get_help_folder_icon("p_paste.png"),
		}, (_original_canvas, _original_ctx, _new_canvas, new_ctx) => {
			draw_generated(new_ctx, img, prompt);
		});
		const caption = caption_for(prompt, img);
		$status.text(caption);
		$status_text.text(`🎨 ${caption}`);
	} finally {
		busy = false;
		$generate.prop("disabled", false);
	}
}

/** Opens the Prompt box (or brings it to the front). */
export function show_prompt_box() {
	if ($prompt_window && !$prompt_window.closed) {
		$prompt_window.bringToFront();
		$prompt_window.$main.find("textarea").trigger("focus");
		return;
	}
	const $w = $DialogWindow("Prompt");
	$prompt_window = $w;
	$w.addClass("ai-prompt-window");
	$w.$main.css({ display: "flex", flexDirection: "column", gap: "6px", padding: "8px", width: "300px" });

	const $label = $(E("label")).text("Describe the image you want:").appendTo($w.$main);
	const $textarea = /** @type {JQuery<HTMLTextAreaElement>} */ ($(E("textarea")))
		.attr({ rows: 3, placeholder: "a cat riding a skateboard, highly detailed, 4k", spellcheck: "false" })
		.css({ width: "100%", boxSizing: "border-box", resize: "none", fontFamily: "inherit" })
		.appendTo($label);
	$label.css({ display: "flex", flexDirection: "column", gap: "4px" });
	$(E("div")).addClass("ai-prompt-preview inset-deep")
		.css({ display: "none", alignSelf: "center", lineHeight: 0, background: "#fff" })
		.appendTo($w.$main);
	$(E("p")).addClass("ai-prompt-status").css({ margin: 0, minHeight: "3.75em", whiteSpace: "normal", overflowWrap: "anywhere" }).appendTo($w.$main);
	$(E("p")).text("Results may resemble existing artwork.").css({ margin: 0, fontSize: "11px", color: "#555" }).appendTo($w.$main);

	// Enter generates; Shift+Enter is a new line
	$textarea.on("keydown", (event) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			generate(String($textarea.val()));
		}
	});
	$w.$Button("Generate", () => {
		generate(String($textarea.val()));
	}).addClass("ai-prompt-generate");
	$w.$Button("Close", () => {
		$w.close();
	});
	$w.on("close", () => {
		if ($prompt_window === $w) { $prompt_window = null; }
	});
	$w.center();
	$textarea.trigger("focus");
}
