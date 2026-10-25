// @ts-check
/* global $canvas_area, localize, systemHooks */
// View › Reference Image: a picture to trace over. It floats over the canvas, faded, and clicks go through it to
// the canvas, so you draw underneath it; it's never part of the picture (not saved, exported, in the undo
// history, or sent to anyone else in a multi-user session or live room). It stays through File › New and Open,
// until it's removed. Drag its grip (top left) to move it; drag its handles to resize it, with Shift to keep its
// proportions. One at a time.
// (A port of 1j01/jspaint pull requests #372–#374, by Meng Jun.)
import { $DialogWindow } from "./$ToolWindow.js";
import { Handles } from "./Handles.js";
import { OnCanvasObject } from "./OnCanvasObject.js";
import { image_formats } from "./file-format-data.js";
import { read_image_file, show_error_message, show_file_format_errors } from "./functions.js";
import { $G, E, make_canvas, make_css_cursor, to_canvas_coords } from "./helpers.js";

const DEFAULT_OPACITY = 0.5;
const MIN_OPACITY = 0.1;

class ReferenceImage extends OnCanvasObject {
	/**
	 * @param {number} x
	 * @param {number} y
	 * @param {HTMLImageElement | HTMLCanvasElement} image
	 * @param {number} [opacity]
	 */
	constructor(x, y, image, opacity = DEFAULT_OPACITY) {
		const canvas = make_canvas(image);
		super(x, y, canvas.width, canvas.height, false);
		this.$el.addClass("reference-image");
		this.canvas = canvas;
		this.$el.append(canvas);
		this.visible = true;
		this.set_opacity(opacity);
		this.position();

		// The grip, inside the top left corner (outside it would be out of reach when the image is at the canvas's edge)
		this.$grip = $(E("div")).addClass("reference-image-grip").attr({ title: localize("Move the reference image") });
		this.$grip.css({ cursor: make_css_cursor("move", [8, 8], "move") });
		this.$el.append(this.$grip);
		/** @type {{ x: number, y: number } | null} */
		let grab = null;
		const pointermove = (/** @type {JQuery.TriggeredEvent} */ event) => {
			if (!grab) { return; }
			const m = to_canvas_coords(event);
			this.x = Math.round(m.x - grab.x);
			this.y = Math.round(m.y - grab.y);
			this.position();
		};
		const pointerup = () => {
			grab = null;
			$G.off("pointermove", pointermove);
			$G.off("pointerup pointercancel", pointerup);
		};
		this.$grip.on("pointerdown", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const m = to_canvas_coords(event);
			grab = { x: m.x - this.x, y: m.y - this.y };
			$G.on("pointermove", pointermove);
			$G.on("pointerup pointercancel", pointerup);
		});
		this._stop_dragging = pointerup;

		this.handles = new Handles({
			$handles_container: this.$el,
			$object_container: $canvas_area,
			outset: 2,
			proportional_with_shift: true,
			get_rect: () => ({ x: this.x, y: this.y, width: this.width, height: this.height }),
			set_rect: ({ x, y, width, height }) => {
				this.x = x;
				this.y = y;
				this.width = Math.max(1, width);
				this.height = Math.max(1, height);
				this.position();
			},
			get_ghost_offset_left: () => parseFloat($canvas_area.css("padding-left")) + 1,
			get_ghost_offset_top: () => parseFloat($canvas_area.css("padding-top")) + 1,
		});
	}
/** @param {number} opacity - 0 to 1 */
	set_opacity(opacity) {
		this.opacity = Math.max(MIN_OPACITY, Math.min(1, opacity));
		this.canvas.style.opacity = String(this.opacity);
	}
/** @param {boolean} visible */
	set_visible(visible) {
		this.visible = visible;
		this.$el.toggleClass("hidden", !visible);
	}
	destroy() {
		this._stop_dragging();
		super.destroy();
	}
}

/** @type {ReferenceImage | null} */
let reference_image = null;

/**
 * Shows a picture as the reference image (replacing any), at the top left of what's in view.
 * @param {HTMLImageElement | HTMLCanvasElement} image
 */
function set_reference_image(image) {
	const opacity = reference_image ? reference_image.opacity : DEFAULT_OPACITY;
	reference_image?.destroy();
	const magnification = /** @type {any} */ (window).magnification || 1;
	reference_image = new ReferenceImage(
		Math.max(0, Math.ceil($canvas_area.scrollLeft() / magnification)),
		Math.max(0, Math.ceil($canvas_area.scrollTop() / magnification)),
		image,
		opacity,
	);
	$G.triggerHandler("reference-image-changed");
	return reference_image;
}

/**
 * Opens a picture file as the reference image.
 * @param {Blob} file
 */
function open_reference_image_file(file) {
	return new Promise((resolve) => {
		read_image_file(file, (error, info) => {
			if (error) {
				show_file_format_errors({ as_image_error: error });
				resolve(false);
				return;
			}
			set_reference_image(info.image || make_canvas(info.image_data));
			resolve(true);
		});
	});
}

/** View › Reference Image › Load Reference Image... */
async function load_reference_image() {
	let file;
	try {
		({ file } = await systemHooks.showOpenFileDialog({ formats: image_formats }));
	} catch (error) {
		if (error && error.name === "AbortError") { return; } // (the file dialog was canceled)
		throw error;
	}
	if (!file) { return; }
	if (!/^image|application\/pdf/.test(file.type) && file.type !== "") {
		show_error_message(localize("This is not a valid bitmap file, or its format is not currently supported."));
		return;
	}
	await open_reference_image_file(file);
}

function has_reference_image() {
	return reference_image !== null;
}

function is_reference_image_visible() {
	return Boolean(reference_image && reference_image.visible);
}

function toggle_reference_image() {
	reference_image?.set_visible(!reference_image.visible);
	$G.triggerHandler("reference-image-changed");
}

function remove_reference_image() {
	reference_image?.destroy();
	reference_image = null;
	$G.triggerHandler("reference-image-changed");
}

/** For tests and the console: the reference image, if any. */
function get_reference_image() {
	return reference_image;
}

/** View › Reference Image › Opacity... */
function show_reference_image_opacity_window() {
	if (!reference_image) { return; }
	const image = reference_image;
	const $w = $DialogWindow(localize("Reference Image Opacity"));
	$w.addClass("reference-image-opacity-window");
	const percent = Math.round(image.opacity * 100);
	const $label = $(E("label")).text(localize("Opacity:")).attr({ for: "reference-opacity-slider" });
	const $slider = $(E("input")).attr({ type: "range", id: "reference-opacity-slider", min: MIN_OPACITY * 100, max: 100, value: percent });
	const $value = $(E("span")).addClass("reference-opacity-value").text(`${percent}%`);
	$w.$main.append($(E("div")).css({ padding: "10px", display: "flex", alignItems: "center", gap: "10px" }).append($label, $slider, $value));
	$slider.on("input", () => {
		const opacity = Number($slider.val()) / 100;
		image.set_opacity(opacity);
		$value.text(`${Math.round(image.opacity * 100)}%`);
	});
	$w.$Button(localize("OK"), () => { $w.close(); }).focus();
	$w.center();
	return $w;
}

export { get_reference_image, has_reference_image, is_reference_image_visible, load_reference_image, open_reference_image_file, remove_reference_image, set_reference_image, show_reference_image_opacity_window, toggle_reference_image };
