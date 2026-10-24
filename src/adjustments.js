// @ts-check
/* global $status_text, main_canvas, main_ctx, selection */

// The Adjustments menu: common image adjustments and filters, plus a few parody ones.
// - Each works on the selection if there is one, otherwise the whole picture, as one undoable step.
// - The ones with "..." open a dialog with sliders and a live preview on the canvas; Cancel puts everything back.
// - The pixel math is plain JS on ImageData (no canvas filters, which not every browser supports).

import { $DialogWindow } from "./$ToolWindow.js";
import { E, get_help_folder_icon, make_canvas } from "./helpers.js";
import { apply_image_transformation } from "./image-manipulation.js";
import { showMessageBox } from "./msgbox.js";

/** @typedef {Record<string, number>} Params */
/** @typedef {(image_data: ImageData, params?: Params) => ImageData} Adjust */
/** @typedef {{ id: string, label: string, min: number, max: number, value: number, step?: number, format?: (value: number) => string, checkbox?: boolean }} Slider */

/** A small seeded random number generator, so noise looks the same in the preview and the result. */
function seeded_random(seed = 1998) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** @param {ImageData} image_data */
function copy_image_data(image_data) {
	return new ImageData(new Uint8ClampedArray(image_data.data), image_data.width, image_data.height);
}

// ---- Adjustments (each changes the ImageData in place and returns it) ----

/** @type {Adjust} */
export function brightness_contrast(image_data, { brightness = 0, contrast = 0 } = {}) {
	const c = contrast * 2.55;
	const factor = (259 * (c + 255)) / (255 * (259 - c));
	const shift = brightness * 2.55;
	const table = new Uint8ClampedArray(256);
	for (let v = 0; v < 256; v++) { table[v] = factor * (v - 128) + 128 + shift; }
	const d = image_data.data;
	for (let i = 0; i < d.length; i += 4) {
		d[i] = table[d[i]];
		d[i + 1] = table[d[i + 1]];
		d[i + 2] = table[d[i + 2]];
	}
	return image_data;
}

/** @type {Adjust} */
export function hue_saturation(image_data, { hue = 0, saturation = 0, lightness = 0 } = {}) {
	const d = image_data.data;
	const s_factor = 1 + saturation / 100;
	const l_amount = lightness / 100;
	for (let i = 0; i < d.length; i += 4) {
		const r = d[i] / 255;
		const g = d[i + 1] / 255;
		const b = d[i + 2] / 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		let h = 0;
		let s = 0;
		let l = (max + min) / 2;
		const delta = max - min;
		if (delta > 0) {
			s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
			if (max === r) {
				h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
			} else if (max === g) {
				h = ((b - r) / delta + 2) / 6;
			} else {
				h = ((r - g) / delta + 4) / 6;
			}
		}
		h = (h + hue / 360 + 1) % 1;
		s = Math.min(1, s * s_factor);
		l = l_amount > 0 ? l + (1 - l) * l_amount : l * (1 + l_amount);
		if (s === 0) {
			d[i] = d[i + 1] = d[i + 2] = l * 255;
			continue;
		}
		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		const channel = (/** @type {number} */ t) => {
			t = (t + 1) % 1;
			if (t < 1 / 6) { return p + (q - p) * 6 * t; }
			if (t < 1 / 2) { return q; }
			if (t < 2 / 3) { return p + (q - p) * (2 / 3 - t) * 6; }
			return p;
		};
		d[i] = channel(h + 1 / 3) * 255;
		d[i + 1] = channel(h) * 255;
		d[i + 2] = channel(h - 1 / 3) * 255;
	}
	return image_data;
}

/** @type {Adjust} */
export function posterize(image_data, { levels = 4 } = {}) {
	const step = 255 / (levels - 1);
	const table = new Uint8ClampedArray(256);
	for (let v = 0; v < 256; v++) { table[v] = Math.round(Math.round(v / step) * step); }
	const d = image_data.data;
	for (let i = 0; i < d.length; i += 4) {
		d[i] = table[d[i]];
		d[i + 1] = table[d[i + 1]];
		d[i + 2] = table[d[i + 2]];
	}
	return image_data;
}

const luma = (/** @type {Uint8ClampedArray} */ d, /** @type {number} */ i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** @type {Adjust} */
export function threshold(image_data, { level = 128 } = {}) {
	const d = image_data.data;
	for (let i = 0; i < d.length; i += 4) {
		d[i] = d[i + 1] = d[i + 2] = luma(d, i) >= level ? 255 : 0;
	}
	return image_data;
}

/** @type {Adjust} */
export function grayscale(image_data) {
	const d = image_data.data;
	for (let i = 0; i < d.length; i += 4) {
		d[i] = d[i + 1] = d[i + 2] = luma(d, i);
	}
	return image_data;
}

/** @type {Adjust} */
export function sepia(image_data) {
	const d = image_data.data;
	for (let i = 0; i < d.length; i += 4) {
		const r = d[i];
		const g = d[i + 1];
		const b = d[i + 2];
		d[i] = 0.393 * r + 0.769 * g + 0.189 * b;
		d[i + 1] = 0.349 * r + 0.686 * g + 0.168 * b;
		d[i + 2] = 0.272 * r + 0.534 * g + 0.131 * b;
	}
	return image_data;
}

/** Stretches the colors to use the full range, ignoring the darkest and lightest 0.5% (each channel). @type {Adjust} */
export function auto_contrast(image_data) {
	const d = image_data.data;
	const counted = d.length / 4;
	const tables = [0, 1, 2].map((c) => {
		const histogram = new Uint32Array(256);
		for (let i = c; i < d.length; i += 4) { histogram[d[i]]++; }
		const clip = counted * 0.005;
		let low = 0;
		let high = 255;
		for (let sum = 0; low < 255 && sum + histogram[low] <= clip; low++) { sum += histogram[low]; }
		for (let sum = 0; high > 0 && sum + histogram[high] <= clip; high--) { sum += histogram[high]; }
		const table = new Uint8ClampedArray(256);
		for (let v = 0; v < 256; v++) { table[v] = high > low ? (v - low) * 255 / (high - low) : v; }
		return table;
	});
	for (let i = 0; i < d.length; i += 4) {
		d[i] = tables[0][d[i]];
		d[i + 1] = tables[1][d[i + 1]];
		d[i + 2] = tables[2][d[i + 2]];
	}
	return image_data;
}

/** One pass of a box blur, horizontally or vertically, on all four channels. */
function box_blur_pass(/** @type {Uint8ClampedArray} */ src, /** @type {Uint8ClampedArray} */ dst, /** @type {number} */ width, /** @type {number} */ height, /** @type {number} */ radius, /** @type {boolean} */ horizontal) {
	const lines = horizontal ? height : width;
	const length = horizontal ? width : height;
	const stride = horizontal ? 4 : width * 4;
	const window_size = radius * 2 + 1;
	for (let line = 0; line < lines; line++) {
		const start = horizontal ? line * width * 4 : line * 4;
		for (let c = 0; c < 4; c++) {
			let sum = 0;
			for (let k = -radius; k <= radius; k++) {
				sum += src[start + Math.min(length - 1, Math.max(0, k)) * stride + c];
			}
			for (let k = 0; k < length; k++) {
				dst[start + k * stride + c] = sum / window_size;
				sum += src[start + Math.min(length - 1, k + radius + 1) * stride + c] - src[start + Math.max(0, k - radius) * stride + c];
			}
		}
	}
}

/** A close-to-Gaussian blur: three box blurs each way. @type {Adjust} */
export function blur(image_data, { radius = 2 } = {}) {
	radius = Math.round(radius);
	if (radius < 1) { return image_data; }
	const { width, height, data } = image_data;
	const temp = new Uint8ClampedArray(data.length);
	const box = Math.max(1, Math.round(radius / Math.sqrt(3)));
	for (let pass = 0; pass < 3; pass++) {
		box_blur_pass(data, temp, width, height, box, true);
		box_blur_pass(temp, data, width, height, box, false);
	}
	return image_data;
}

/** An unsharp mask. @type {Adjust} */
export function sharpen(image_data, { amount = 100, radius = 1 } = {}) {
	const blurred = blur(copy_image_data(image_data), { radius });
	const d = image_data.data;
	const b = blurred.data;
	const k = amount / 100;
	for (let i = 0; i < d.length; i += 4) {
		d[i] = d[i] + (d[i] - b[i]) * k;
		d[i + 1] = d[i + 1] + (d[i + 1] - b[i + 1]) * k;
		d[i + 2] = d[i + 2] + (d[i + 2] - b[i + 2]) * k;
	}
	return image_data;
}

/** @type {Adjust} */
export function add_noise(image_data, { amount = 20, color = 0, seed = 1998 } = {}) {
	const random = seeded_random(seed);
	const d = image_data.data;
	const spread = amount * 2.55;
	for (let i = 0; i < d.length; i += 4) {
		if (color) {
			d[i] += (random() - 0.5) * spread;
			d[i + 1] += (random() - 0.5) * spread;
			d[i + 2] += (random() - 0.5) * spread;
		} else {
			const n = (random() - 0.5) * spread;
			d[i] += n;
			d[i + 1] += n;
			d[i + 2] += n;
		}
	}
	return image_data;
}

/** Applies a 3x3 kernel (to the color channels), plus an offset. */
function convolve(/** @type {ImageData} */ image_data, /** @type {number[]} */ kernel, offset = 0) {
	const { width, height } = image_data;
	const src = new Uint8ClampedArray(image_data.data);
	const d = image_data.data;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			for (let c = 0; c < 3; c++) {
				let sum = 0;
				for (let ky = -1; ky <= 1; ky++) {
					const yy = Math.min(height - 1, Math.max(0, y + ky));
					for (let kx = -1; kx <= 1; kx++) {
						const xx = Math.min(width - 1, Math.max(0, x + kx));
						sum += src[(yy * width + xx) * 4 + c] * kernel[(ky + 1) * 3 + kx + 1];
					}
				}
				d[i + c] = sum + offset;
			}
		}
	}
	return image_data;
}

/** @type {Adjust} */
export function emboss(image_data) {
	return grayscale(convolve(image_data, [-2, -1, 0, -1, 0, 1, 0, 1, 2], 128)); // gray relief
}

/** Edges as dark lines on white. @type {Adjust} */
export function find_edges(image_data) {
	const { width, height } = image_data;
	const gray = grayscale(copy_image_data(image_data)).data;
	const d = image_data.data;
	const at = (/** @type {number} */ x, /** @type {number} */ y) => gray[(Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4];
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
			const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
			const i = (y * width + x) * 4;
			d[i] = d[i + 1] = d[i + 2] = 255 - Math.min(255, Math.hypot(gx, gy));
		}
	}
	return image_data;
}

/** Darkens toward the corners. @type {Adjust} */
export function vignette(image_data, { amount = 50 } = {}) {
	const { width, height, data: d } = image_data;
	const cx = width / 2;
	const cy = height / 2;
	const max = Math.hypot(cx, cy);
	const k = amount / 100;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const t = Math.hypot(x - cx, y - cy) / max;
			const f = 1 - k * t * t;
			const i = (y * width + x) * 4;
			d[i] *= f;
			d[i + 1] *= f;
			d[i + 2] *= f;
		}
	}
	return image_data;
}

// ---- Parody adjustments ----

const POP_WORDS = ["Not popping", "Barely popping", "Popping", "Really popping", "Popped", "Too much pop", "Exploded"];

/** Make It Pop: contrast and saturation, then more. @type {Adjust} */
export function make_it_pop(image_data, { pop = 50 } = {}) {
	hue_saturation(image_data, { hue: 0, saturation: pop * 1.6, lightness: 0 });
	brightness_contrast(image_data, { brightness: pop / 10, contrast: pop * 0.6 });
	if (pop > 80) { sharpen(image_data, { amount: (pop - 80) * 10, radius: 1 }); }
	return image_data;
}

/** The 1998 film look: warm, faded, grainy, vignetted. (The date stamp is drawn separately.) @type {Adjust} */
export function film_1998(image_data) {
	const d = image_data.data;
	for (let i = 0; i < d.length; i += 4) {
		// warm it up, and lift the blacks (faded)
		d[i] = 28 + d[i] * 0.9 + 10;
		d[i + 1] = 22 + d[i + 1] * 0.86;
		d[i + 2] = 30 + d[i + 2] * 0.72;
	}
	hue_saturation(image_data, { hue: 0, saturation: -25, lightness: 0 });
	add_noise(image_data, { amount: 12, color: 1, seed: 98 });
	return vignette(image_data, { amount: 45 });
}

/** The date stamp in the corner, like a 1998 point-and-shoot camera. */
function draw_date_stamp(/** @type {CanvasRenderingContext2D} */ ctx) {
	const { width, height } = ctx.canvas;
	const now = new Date();
	const text = `'98 ${String(now.getMonth() + 1).padStart(2, " ")} ${String(now.getDate()).padStart(2, "0")}`;
	const size = Math.max(10, Math.round(Math.min(width, height) / 18));
	ctx.save();
	ctx.font = `bold ${size}px "Courier New", monospace`;
	ctx.textAlign = "right";
	ctx.textBaseline = "bottom";
	ctx.shadowColor = "rgba(255, 120, 0, 0.9)";
	ctx.shadowBlur = size / 3;
	ctx.fillStyle = "#ff9a2e";
	ctx.fillText(text, width - size * 0.8, height - size * 0.6);
	ctx.restore();
}

/** A 90s lens flare: a bright glow, a halo, and a trail of rings toward the middle. */
function draw_lens_flare(/** @type {CanvasRenderingContext2D} */ ctx) {
	const { width, height } = ctx.canvas;
	const x = width * 0.78;
	const y = height * 0.22;
	const size = Math.min(width, height);
	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 0.25);
	glow.addColorStop(0, "rgba(255, 255, 255, 1)");
	glow.addColorStop(0.08, "rgba(255, 250, 220, 0.9)");
	glow.addColorStop(0.3, "rgba(255, 200, 120, 0.25)");
	glow.addColorStop(1, "rgba(255, 160, 80, 0)");
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, width, height);
	// the halo ring
	const halo = ctx.createRadialGradient(x, y, size * 0.13, x, y, size * 0.16);
	halo.addColorStop(0, "rgba(120, 180, 255, 0)");
	halo.addColorStop(0.5, "rgba(160, 200, 255, 0.25)");
	halo.addColorStop(1, "rgba(120, 180, 255, 0)");
	ctx.fillStyle = halo;
	ctx.fillRect(0, 0, width, height);
	// streaks
	ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
	ctx.lineWidth = Math.max(1, size / 300);
	for (const angle of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
		const length = size * (angle === 0 ? 0.35 : 0.15);
		ctx.beginPath();
		ctx.moveTo(x - Math.cos(angle) * length, y - Math.sin(angle) * length);
		ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
		ctx.stroke();
	}
	// the trail of rings, through the middle of the picture
	const rings = [[0.35, 0.03, "rgba(255, 120, 60, 0.35)"], [0.55, 0.05, "rgba(120, 255, 140, 0.18)"], [0.75, 0.018, "rgba(255, 255, 255, 0.4)"], [1.05, 0.08, "rgba(100, 140, 255, 0.15)"], [1.3, 0.04, "rgba(255, 80, 200, 0.2)"]];
	for (const [t, r, color] of rings) {
		const rx = x + (width / 2 - x) * /** @type {number} */ (t) * 1.4;
		const ry = y + (height / 2 - y) * /** @type {number} */ (t) * 1.4;
		ctx.fillStyle = /** @type {string} */ (color);
		ctx.beginPath();
		const radius = size * /** @type {number} */ (r);
		for (let k = 0; k < 6; k++) { // hexagons, from the aperture blades
			const a = k * Math.PI / 3;
			ctx.lineTo(rx + Math.cos(a) * radius, ry + Math.sin(a) * radius);
		}
		ctx.fill();
	}
	ctx.restore();
}

// ---- Applying ----

/** The canvas the adjustment applies to: the selection, or the whole picture. */
function target_canvas() {
	return /** @type {HTMLCanvasElement & { ctx: CanvasRenderingContext2D }} */ (selection ? selection.source_canvas : main_canvas);
}

/**
 * Applies a pixel adjustment (and optionally a drawing on top) as one undoable step.
 * @param {string} name
 * @param {(image_data: ImageData) => ImageData} adjust
 * @param {(ctx: CanvasRenderingContext2D) => void} [draw_after]
 */
function apply_adjustment(name, adjust, draw_after) {
	apply_image_transformation({
		name,
		icon: get_help_folder_icon("p_invert.png"),
	}, (original_canvas, original_ctx, new_canvas, new_ctx) => {
		const image_data = original_ctx.getImageData(0, 0, original_canvas.width, original_canvas.height);
		new_ctx.putImageData(adjust(image_data), 0, 0);
		if (draw_after) {
			// draw on top, but keep the shape (alpha) of a free-form selection
			const overlay = make_canvas(new_canvas.width, new_canvas.height);
			draw_after(overlay.ctx);
			if (selection) {
				overlay.ctx.globalCompositeOperation = "destination-in";
				overlay.ctx.drawImage(original_canvas, 0, 0);
			}
			new_ctx.drawImage(overlay, 0, 0);
		}
	});
}

/**
 * A dialog with sliders and a live preview on the canvas (or selection).
 * @param {{ title: string, name?: string, sliders: Slider[], adjust: Adjust, describe?: (params: Params) => string, done?: (params: Params) => void }} options
 */
export function show_adjustment_dialog({ title, name = title, sliders, adjust, describe, done }) {
	const target = target_canvas();
	const original = target.ctx.getImageData(0, 0, target.width, target.height);
	const in_selection = Boolean(selection);
	const preview_ctx = in_selection ? /** @type {HTMLCanvasElement & { ctx: CanvasRenderingContext2D }} */ (selection.canvas).ctx : main_ctx;
	/** @type {Params} */
	const params = Object.fromEntries(sliders.map((slider) => [slider.id, slider.value]));

	const $w = $DialogWindow(title);
	$w.addClass("adjustment-window");
	$w.$main.css({ padding: "8px", width: "280px", display: "flex", flexDirection: "column", gap: "6px", whiteSpace: "normal" });
	/** @type {{ slider: Slider, $input: JQuery<HTMLInputElement>, $value: JQuery<HTMLElement> }[]} */
	const controls = [];
	for (const slider of sliders) {
		const id = `adjustment-${slider.id}`;
		if (slider.checkbox) {
			const $row = $(E("div")).appendTo($w.$main);
			const $input = /** @type {JQuery<HTMLInputElement>} */ ($(E("input"))).attr({ type: "checkbox", id }).prop("checked", Boolean(slider.value)).addClass(`adjustment-slider-${slider.id}`).appendTo($row);
			$(E("label")).attr("for", id).text(slider.label).appendTo($row);
			controls.push({ slider, $input, $value: $(E("span")) });
			continue;
		}
		const $row = $(E("div")).css({ display: "grid", gridTemplateColumns: "80px 1fr 44px", alignItems: "center", gap: "6px" }).appendTo($w.$main);
		$(E("label")).attr("for", id).text(slider.label).appendTo($row);
		const $input = /** @type {JQuery<HTMLInputElement>} */ ($(E("input"))).attr({ type: "range", id, min: slider.min, max: slider.max, step: slider.step ?? 1, value: slider.value }).addClass(`adjustment-slider-${slider.id}`).appendTo($row);
		const $value = $(E("span")).css({ textAlign: "right" }).appendTo($row);
		controls.push({ slider, $input, $value });
	}
	const $description = $(E("p")).css({ margin: 0, minHeight: "1.3em", fontStyle: "italic" }).appendTo($w.$main);
	// (the theme draws checkboxes on the label that follows them)
	const $preview = $(E("div")).appendTo($w.$main);
	const $preview_checkbox = /** @type {JQuery<HTMLInputElement>} */ ($(E("input"))).attr({ type: "checkbox", id: "adjustment-preview" }).prop("checked", true).appendTo($preview);
	$(E("label")).attr("for", "adjustment-preview").text("Preview").appendTo($preview);

	let frame = 0;
	const show_preview = () => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			const image_data = $preview_checkbox.prop("checked") ? adjust(copy_image_data(original), params) : original;
			preview_ctx.putImageData(image_data, 0, 0);
		});
	};
	const update = () => {
		for (const { slider, $input, $value } of controls) {
			params[slider.id] = slider.checkbox ? Number($input.prop("checked")) : Number($input.val());
			$value.text(slider.format ? slider.format(params[slider.id]) : String(params[slider.id]));
		}
		$description.text(describe ? describe(params) : "");
		show_preview();
	};
	for (const { $input } of controls) { $input.on("input change", update); }
	$preview_checkbox.on("change", show_preview);

	let finished = false;
	const restore = () => {
		cancelAnimationFrame(frame);
		if (in_selection && selection) {
			selection.update_tool_transparent_mode(); // redraws the selection from its (unchanged) source
		} else if (!in_selection) {
			main_ctx.putImageData(original, 0, 0);
		}
	};
	$w.$Button("OK", () => {
		finished = true;
		restore();
		$w.close();
		apply_adjustment(name, (image_data) => adjust(image_data, params));
		done?.(params);
	}, { type: "submit" });
	$w.$Button("Cancel", () => { $w.close(); });
	$w.on("close", () => {
		if (!finished) { restore(); }
	});
	$w.center();
	update();
}

// ---- Menu actions ----

const signed = (/** @type {number} */ v) => (v > 0 ? `+${v}` : String(v));

export function show_brightness_contrast() {
	show_adjustment_dialog({
		title: "Brightness/Contrast",
		sliders: [
			{ id: "brightness", label: "Brightness:", min: -100, max: 100, value: 0, format: signed },
			{ id: "contrast", label: "Contrast:", min: -100, max: 100, value: 0, format: signed },
		],
		adjust: brightness_contrast,
	});
}

export function show_hue_saturation() {
	show_adjustment_dialog({
		title: "Hue/Saturation",
		sliders: [
			{ id: "hue", label: "Hue:", min: -180, max: 180, value: 0, format: (v) => `${signed(v)}°` },
			{ id: "saturation", label: "Saturation:", min: -100, max: 100, value: 0, format: signed },
			{ id: "lightness", label: "Lightness:", min: -100, max: 100, value: 0, format: signed },
		],
		adjust: hue_saturation,
	});
}

export function show_posterize() {
	show_adjustment_dialog({
		title: "Posterize",
		sliders: [{ id: "levels", label: "Levels:", min: 2, max: 32, value: 4 }],
		adjust: posterize,
	});
}

export function show_threshold() {
	show_adjustment_dialog({
		title: "Threshold",
		sliders: [{ id: "level", label: "Level:", min: 1, max: 255, value: 128 }],
		adjust: threshold,
	});
}

export function show_blur() {
	show_adjustment_dialog({
		title: "Blur",
		sliders: [{ id: "radius", label: "Radius:", min: 1, max: 30, value: 3, format: (v) => `${v} px` }],
		adjust: blur,
	});
}

export function show_sharpen() {
	show_adjustment_dialog({
		title: "Sharpen",
		sliders: [
			{ id: "amount", label: "Amount:", min: 0, max: 300, value: 100, format: (v) => `${v}%` },
			{ id: "radius", label: "Radius:", min: 1, max: 5, value: 1, format: (v) => `${v} px` },
		],
		adjust: sharpen,
	});
}

export function show_add_noise() {
	show_adjustment_dialog({
		title: "Add Noise",
		sliders: [
			{ id: "amount", label: "Amount:", min: 0, max: 100, value: 20, format: (v) => `${v}%` },
			{ id: "color", label: "Color noise", min: 0, max: 1, value: 0, checkbox: true },
		],
		adjust: add_noise,
	});
}

export const apply_auto_contrast = () => apply_adjustment("Auto Contrast", auto_contrast);
export const apply_grayscale = () => apply_adjustment("Grayscale", grayscale);
export const apply_sepia = () => apply_adjustment("Sepia", sepia);
export const apply_emboss = () => apply_adjustment("Emboss", emboss);
export const apply_find_edges = () => apply_adjustment("Find Edges", find_edges);

export function show_make_it_pop() {
	show_adjustment_dialog({
		title: "Make It Pop",
		sliders: [{ id: "pop", label: "Pop:", min: 0, max: 100, value: 60, format: (v) => `${v}%` }],
		adjust: make_it_pop,
		describe: ({ pop }) => POP_WORDS[Math.min(POP_WORDS.length - 1, Math.floor(pop / 100 * (POP_WORDS.length - 1) + 0.5))],
		done: ({ pop }) => {
			$status_text.text(pop > 95 ? "It popped. We're not sure what you expected." : "It's popping now. You're welcome.");
		},
	});
}

/** Deep Fry: crank everything, then crush it as a terrible JPEG a few times. */
export async function apply_deep_fry() {
	const source = target_canvas();
	// fry a copy first (re-encoding as JPEG is asynchronous), then apply the result as one step
	const fried = make_canvas(source.width, source.height);
	const image_data = source.ctx.getImageData(0, 0, source.width, source.height);
	hue_saturation(image_data, { hue: 0, saturation: 100, lightness: 0 });
	brightness_contrast(image_data, { brightness: 5, contrast: 60 });
	sharpen(image_data, { amount: 250, radius: 1 });
	add_noise(image_data, { amount: 15, color: 1, seed: 375 });
	const d = image_data.data;
	for (let i = 0; i < d.length; i += 4) { // golden brown
		d[i] = d[i] * 1.2 + 20;
		d[i + 1] = d[i + 1] * 1.02 + 6;
		d[i + 2] = d[i + 2] * 0.6;
	}
	fried.ctx.putImageData(image_data, 0, 0);
	for (let i = 0; i < 3; i++) {
		const img = new Image();
		img.src = fried.toDataURL("image/jpeg", 0.08);
		await img.decode();
		fried.ctx.clearRect(0, 0, fried.width, fried.height);
		fried.ctx.drawImage(img, 0, 0);
	}
	const fried_data = fried.ctx.getImageData(0, 0, fried.width, fried.height);
	apply_adjustment("Deep Fry", (original) => {
		// keep the original transparency (JPEG has none)
		for (let i = 3; i < original.data.length; i += 4) { fried_data.data[i] = original.data[i]; }
		return fried_data;
	});
	$status_text.text("Deep fried at 375°F. Serve immediately.");
}

export function apply_film_1998() {
	apply_adjustment("1998 Film Filter", film_1998, draw_date_stamp);
	$status_text.text("Developed in one hour. 24 exposures, 23 of them of your thumb.");
}

export function apply_lens_flare() {
	apply_adjustment("Add Lens Flare", (image_data) => image_data, draw_lens_flare);
	$status_text.text("Lens flare added. Your picture is now 40% more cinematic.");
}

/** Fix Everything: thinks hard, then changes nothing. */
export function fix_everything() {
	const $w = $DialogWindow("Fix Everything");
	$w.addClass("fix-everything-window");
	$w.$main.css({ padding: "10px", width: "260px", whiteSpace: "normal" });
	const $step = $(E("p")).css({ margin: "0 0 8px" }).appendTo($w.$main);
	const $progress = $(E("progress")).attr({ max: 100, value: 0 }).css({ width: "100%" }).appendTo($w.$main);
	const steps = ["Looking for problems...", "Looking harder...", "Squinting...", "Asking the paperclip...", "Fixing..."];
	$w.$Button("Cancel", () => { $w.close(); });
	$w.center();
	const started = performance.now();
	const tick = () => {
		if ($w.closed) { return; }
		const t = Math.min(1, (performance.now() - started) / 2500);
		$progress.attr("value", Math.round(t * 100));
		$step.text(steps[Math.min(steps.length - 1, Math.floor(t * steps.length))]);
		if (t < 1) {
			setTimeout(tick, 50);
			return;
		}
		$w.close();
		showMessageBox({
			title: "Fix Everything",
			iconID: "info",
			message: "Fix Everything found 0 problems.\n\nYour picture was perfect all along. We've fixed nothing, very carefully.",
		});
	};
	tick();
}
