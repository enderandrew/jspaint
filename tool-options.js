// @ts-check
/* global localize, stroke_size:writable, airbrush_size:writable, brush_shape:writable, brush_size:writable, eraser_size:writable, magnification:writable, tool_transparent_mode:writable */
import { set_magnification } from "./functions.js";
import { $G, E, make_canvas } from "./helpers.js";
import { get_fill_tolerance, render_brush, replace_colors_with_swatch, set_fill_tolerance, stamp_brush_canvas } from "./image-manipulation.js";
import { get_theme } from "./theme.js";

const ChooserCanvas = (
	url,
	invert,
	width,
	height,
	sourceX,
	sourceY,
	sourceWidth,
	sourceHeight,
	destX,
	destY,
	destWidth,
	destHeight,
	reuse_canvas,
) => {
	const c = reuse_canvas(width, height);
	let img = ChooserCanvas.cache[url];
	if (!img) {
		img = ChooserCanvas.cache[url] = E("img");
		img.onerror = () => {
			delete ChooserCanvas.cache[url];
		};
		img.src = url;
	}
	const render = () => {
		try {
			c.ctx.drawImage(
				img,
				sourceX, sourceY, sourceWidth, sourceHeight,
				destX, destY, destWidth, destHeight
			);
		} catch (_error) { /* ignore */ }
		// if (invert) {
		// 	invert_rgb(c.ctx); // can fail due to tainted canvas if running from file: protocol
		// }
		c.style.filter = invert ? "invert()" : "";
	};
	$(img).on("load", render);
	render();
	return c;
};
ChooserCanvas.cache = {};

// @TODO: convert all options to use this themeable version (or more options? some are dynamically rendered...)
const ChooserDiv = (
	class_name,
	invert,
	width,
	height,
	sourceX,
	sourceY,
	sourceWidth,
	sourceHeight,
	destX,
	destY,
	destWidth,
	destHeight,
	reuse_div,
	shift_y_by_1px_in_modern_theme_only,
) => {
	const div = reuse_div(width, height);
	div.classList.add(class_name);
	div.style.width = sourceWidth + "px";
	div.style.height = sourceHeight + "px";

	// @TODO: single listener for all divs
	const on_zoom_etc = () => {
		const modern = get_theme() === "modern.css" || get_theme() === "modern-dark.css" || get_theme() === "bubblegum.css";
		const use_svg = modern ?
			// only use raster when screen pixels line up with image pixels exactly
			(window.devicePixelRatio !== 1) :
			// with nearest neighbor scaling, favor raster at larger integer sizes as well, for retro look
			(window.devicePixelRatio >= 3 || (window.devicePixelRatio % 1) !== 0);
		div.classList.toggle("use-svg", use_svg);
		// The classic theme's transparency tool options spritesheet uses an
		// overlapped border, shared by the top and bottom options, as it is
		// simply a row of black for both, whereas the modern theme's spritesheet
		// uses a gradient in the border, and so does not use an overlap trick.
		// This might be clearer if I made the option "shift_y_by_1px_in_classic_themes" with the baseline being the modern theme's metrics.
		div.style.backgroundPosition = `${-sourceX}px ${-sourceY - (modern && shift_y_by_1px_in_modern_theme_only ? 1 : 0)}px`;
	};
	if (div._on_zoom_etc) { // condition is needed, otherwise it will remove all listeners! (leading to only the last graphic being updated when zooming)
		$G.off("theme-load resize", div._on_zoom_etc);
	}
	$G.on("theme-load resize", on_zoom_etc);
	div._on_zoom_etc = on_zoom_etc;
	on_zoom_etc();

	div.style.borderColor = "transparent";
	div.style.borderStyle = "solid";
	div.style.borderLeftWidth = destX + "px";
	div.style.borderTopWidth = destY + "px";
	div.style.borderRightWidth = (width - destX - destWidth) + "px";
	div.style.borderBottomWidth = (height - destY - destHeight) + "px";
	div.style.backgroundClip = "content-box";
	div.style.filter = invert ? "invert()" : "";
	return div;
};


/**
 * @template T
 * @param {T[]} things
 * @param {(thing: T, is_chosen: boolean, reuse_canvas: (width: number, height: number) => PixelCanvas, reuse_div: (width: number, height: number) => HTMLDivElement) => HTMLCanvasElement | HTMLDivElement} display
 * @param {(thing: T) => void} choose
 * @param {(thing: T) => boolean} is_chosen
 * @param {boolean=} gray_background_for_unselected
 * @returns {JQuery<HTMLDivElement> & { stroke?: boolean, fill?: boolean }}
 */
const $Choose = (things, display, choose, is_chosen, gray_background_for_unselected) => {
	const $chooser = $(E("div")).addClass("chooser").css("touch-action", "none");
	const choose_thing = (thing) => {
		if (is_chosen(thing)) {
			return;
		}
		choose(thing);
		$G.trigger("option-changed");
	};
	// Each option's redraw, for the options shown now. (One set of listeners per chooser, made once: this used to
	// add a listener per option every time the chooser was shown, so they piled up with every tool switch.)
	/** @type {(() => void)[]} */
	let option_updaters = [];
	$G.on("option-changed theme-load redraw-tool-options-because-webglcontextrestored", () => {
		for (const update of option_updaters) { update(); }
	});
	$chooser.on("update", () => {
		if (!$chooser.is(":visible")) {
			return;
		}
		// (option pictures drawn with ChooserDiv listen for zoom and theme changes; the old ones are thrown away here)
		$chooser.find("div").each((_i, div) => {
			const on_zoom_etc = /** @type {any} */ (div)._on_zoom_etc;
			if (on_zoom_etc) { $G.off("theme-load resize", on_zoom_etc); }
		});
		$chooser.empty();
		option_updaters = [];
		for (let i = 0; i < things.length; i++) {
			((thing) => {
				const $option_container = $(E("div")).addClass("chooser-option").appendTo($chooser);
				// @ts-ignore
				$option_container.data("thing", thing);
				/**
				 * @param {number} width
				 * @param {number} height
				 * @returns {PixelCanvas}
				 */
				const reuse_canvas = (width, height) => {
					let option_canvas = /** @type {PixelCanvas | undefined} */ ($option_container.find("canvas")[0]);
					if (option_canvas) {
						if (option_canvas.width !== width) { option_canvas.width = width; }
						if (option_canvas.height !== height) { option_canvas.height = height; }
					} else {
						option_canvas = make_canvas(width, height);
						$option_container.append(option_canvas);
					}
					return option_canvas;
				};
				const reuse_div = (width, height) => {
					let option_div = $option_container.find("div")[0];
					if (option_div) {
						if (option_div.style.width !== width + "px") { option_div.style.width = width + "px"; }
						if (option_div.style.height !== height + "px") { option_div.style.height = height + "px"; }
					} else {
						option_div = E("div");
						option_div.style.width = width + "px";
						option_div.style.height = height + "px";
						$option_container.append(option_div);
					}
					return option_div;
				};
				const update = () => {
					const selected_color = getComputedStyle($chooser[0]).getPropertyValue("--Hilight");
					const unselected_color = gray_background_for_unselected ? "rgb(192, 192, 192)" : "";
					$option_container.css({
						backgroundColor: is_chosen(thing) ? selected_color : unselected_color,
					});
					display(thing, is_chosen(thing), reuse_canvas, reuse_div);
				};
				update();
				option_updaters.push(update);
			})(things[i]);
		}
	});

	{
		const onpointerover_while_pointer_down = (event) => {
			const option_container = event.target.closest(".chooser-option");
			if (option_container) {
				choose_thing($(option_container).data("thing"));
			}
		};
		const ontouchmove_while_pointer_down = (event) => {
			const touch = event.originalEvent.changedTouches[0];
			const target = document.elementFromPoint(touch.clientX, touch.clientY);
			const option_container = target.closest(".chooser-option");
			if (option_container) {
				choose_thing($(option_container).data("thing"));
			}
			event.preventDefault();
		};
		$chooser.on("pointerdown click", (event) => {
			const option_container = event.target.closest(".chooser-option");
			if (option_container) {
				choose_thing($(option_container).data("thing"));
			}
			if (event.type === "pointerdown") {
				// glide thru tool options
				$chooser.on("pointerover", onpointerover_while_pointer_down);
				$chooser.on("touchmove", ontouchmove_while_pointer_down);
			}
		});
		$G.on("pointerup pointercancel", () => {
			$chooser.off("pointerover", onpointerover_while_pointer_down);
			$chooser.off("touchmove", ontouchmove_while_pointer_down);
		});
	}
	return $chooser;
};
/**
 * @returns {JQuery<HTMLCanvasElement> & { stroke: boolean, fill: boolean }}
 */
const $ChooseShapeStyle = () => {
	const $chooser = $Choose(
		[
			{ stroke: true, fill: false },
			{ stroke: true, fill: true },
			{ stroke: false, fill: true },
		],
		({ stroke, fill }, is_chosen, reuse_canvas) => {
			const ss_canvas = reuse_canvas(39, 21);
			const ss_ctx = ss_canvas.ctx;

			// border px inwards amount
			let b = 5;

			const style = getComputedStyle(ss_canvas);
			ss_ctx.fillStyle = is_chosen ? style.getPropertyValue("--HilightText") : style.getPropertyValue("--WindowText");

			if (stroke) {
				// just using a solid rectangle for the stroke
				// so as not to have to deal with the pixel grid with strokes
				ss_ctx.fillRect(b, b, ss_canvas.width - b * 2, ss_canvas.height - b * 2);
			}

			// go inward a pixel for the fill
			b += 1;
			ss_ctx.fillStyle = style.getPropertyValue("--ButtonShadow");

			if (fill) {
				ss_ctx.fillRect(b, b, ss_canvas.width - b * 2, ss_canvas.height - b * 2);
			} else {
				ss_ctx.clearRect(b, b, ss_canvas.width - b * 2, ss_canvas.height - b * 2);
			}

			return ss_canvas;
		},
		({ stroke, fill }) => {
			$chooser.stroke = stroke;
			$chooser.fill = fill;
		},
		({ stroke, fill }) => $chooser.stroke === stroke && $chooser.fill === fill
	).addClass("choose-shape-style");

	$chooser.fill = false;
	$chooser.stroke = true;

	return $chooser;
};

const $choose_brush = $Choose(
	(() => {
		const brush_shapes = ["circle", "square", "reverse_diagonal", "diagonal"];
		const circular_brush_sizes = [7, 4, 1];
		const brush_sizes = [8, 5, 2];
		const things = [];
		brush_shapes.forEach((brush_shape) => {
			const sizes = brush_shape === "circle" ? circular_brush_sizes : brush_sizes;
			sizes.forEach((brush_size) => {
				things.push({
					shape: brush_shape,
					size: brush_size,
				});
			});
		});
		return things;
	})(),
	(o, is_chosen, reuse_canvas) => {
		const cb_canvas = reuse_canvas(10, 10);
		const style = getComputedStyle(cb_canvas);

		const shape = o.shape;
		const size = o.size;
		const color = is_chosen ? style.getPropertyValue("--HilightText") : style.getPropertyValue("--WindowText");

		stamp_brush_canvas(cb_canvas.ctx, 5, 5, shape, size);
		replace_colors_with_swatch(cb_canvas.ctx, color);

		return cb_canvas;
	}, ({ shape, size }) => {
		brush_shape = shape;
		brush_size = size;
	}, ({ shape, size }) => brush_shape === shape && brush_size === size
).addClass("choose-brush");

const $choose_eraser_size = $Choose(
	[4, 6, 8, 10],
	(size, is_chosen, reuse_canvas) => {
		const ce_canvas = reuse_canvas(39, 16);

		const style = getComputedStyle(ce_canvas);
		ce_canvas.ctx.fillStyle = is_chosen ? style.getPropertyValue("--HilightText") : style.getPropertyValue("--WindowText");
		render_brush(ce_canvas.ctx, "square", size);

		return ce_canvas;
	},
	(size) => {
		eraser_size = size;
	},
	(size) => eraser_size === size
).addClass("choose-eraser");

const $choose_stroke_size = $Choose(
	[1, 2, 3, 4, 5],
	(size, is_chosen, reuse_canvas) => {
		const w = 39, h = 12, b = 5;
		const cs_canvas = reuse_canvas(w, h);
		const center_y = (h - size) / 2;
		const style = getComputedStyle(cs_canvas);
		cs_canvas.ctx.fillStyle = is_chosen ? style.getPropertyValue("--HilightText") : style.getPropertyValue("--WindowText");
		cs_canvas.ctx.fillRect(b, ~~center_y, w - b * 2, size);
		return cs_canvas;
	},
	(size) => {
		stroke_size = size;
	},
	(size) => stroke_size === size
).addClass("choose-stroke-size");

// The Magnifier's options: a zoom slider, as in later versions of Paint (it used to be four fixed choices: 1×, 2×, 6×,
// 8×, and a hidden 10×). Up zooms in. It goes from 12.5% to 1000% (Custom Zoom's limit), and follows any zoom,
// from View › Zoom, the Magnifier, or pinching; a zoom between the steps shows between them.
// Drag it, click along it, use the arrow keys (Home/End for the ends), or scroll over it.
const ZOOM_LEVELS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 10];
/** @param {number} scale */
const zoom_percent_text = (scale) => `${+(scale * 100).toFixed(1)}%`;
/** Where a zoom falls along the steps (fractional between two), so any zoom has a place. @param {number} scale */
const zoom_position = (scale) => {
	if (scale <= ZOOM_LEVELS[0]) { return 0; }
	for (let i = 1; i < ZOOM_LEVELS.length; i++) {
		if (scale <= ZOOM_LEVELS[i]) {
			const below = ZOOM_LEVELS[i - 1], above = ZOOM_LEVELS[i];
			return i - 1 + Math.log(scale / below) / Math.log(above / below);
		}
	}
	return ZOOM_LEVELS.length - 1;
};
/** Zooms around the middle of what's in view (the slider isn't pointing anywhere on the picture). @param {number} scale */
const zoom_to = (scale) => {
	if (scale === magnification) { return; }
	const $area = $(".canvas-area");
	set_magnification(scale, {
		x: ($area.scrollLeft() + $area.innerWidth() / 2) / magnification,
		y: ($area.scrollTop() + $area.innerHeight() / 2) / magnification,
	});
};
const $choose_magnification = (() => {
	const $slider = $(E("div")).addClass("choose-magnification zoom-slider").attr({
		role: "slider",
		tabindex: 0,
		"aria-label": localize("Zoom"),
		"aria-orientation": "vertical",
		"aria-valuemin": ZOOM_LEVELS[0] * 100,
		"aria-valuemax": ZOOM_LEVELS[ZOOM_LEVELS.length - 1] * 100,
	}).css("touch-action", "none");
	const $track = $(E("div")).addClass("zoom-slider-track").appendTo($slider);
	for (let i = 0; i < ZOOM_LEVELS.length; i++) {
		$(E("div")).addClass("zoom-slider-tick").toggleClass("zoom-slider-tick-100", ZOOM_LEVELS[i] === 1).appendTo($track).data("index", i);
	}
	const $thumb = $(E("div")).addClass("zoom-slider-thumb").appendTo($track);
	const $label = $(E("div")).addClass("zoom-slider-label").appendTo($slider);
	/** Track positions, from the top (most zoomed in) to the bottom. */
	const y_for = (/** @type {number} */ position) => (1 - position / (ZOOM_LEVELS.length - 1)) * 100;
	const update = () => {
		$track.children(".zoom-slider-tick").each((_i, tick) => {
			tick.style.top = `${y_for($(tick).data("index"))}%`;
		});
		$thumb.css("top", `${y_for(zoom_position(magnification))}%`);
		$label.text(zoom_percent_text(magnification));
		$slider.attr({ "aria-valuenow": +(magnification * 100).toFixed(1), "aria-valuetext": zoom_percent_text(magnification) });
		$slider.attr("title", `${localize("Zoom")}: ${zoom_percent_text(magnification)}`);
	};
	$slider.on("update", update);
	$G.on("magnification-changed option-changed", () => { if ($slider[0].isConnected) { update(); } });

	/** The step nearest a point on the track. @param {number} client_y */
	const index_at = (client_y) => {
		const rect = $track[0].getBoundingClientRect();
		const fraction = 1 - Math.min(1, Math.max(0, (client_y - rect.top) / rect.height));
		return Math.round(fraction * (ZOOM_LEVELS.length - 1));
	};
	const step = (/** @type {number} */ by) => {
		const position = zoom_position(magnification);
		// (from between two steps, the first step goes to the next one in that direction)
		const index = by > 0 ? Math.floor(position + 1e-6) + by : Math.ceil(position - 1e-6) + by;
		zoom_to(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index))]);
	};
	$slider.on("pointerdown", (event) => {
		event.preventDefault();
		$slider[0].focus();
		const pointer_id = event.pointerId;
		zoom_to(ZOOM_LEVELS[index_at(event.clientY)]);
		const move = (/** @type {PointerEvent} */ e) => {
			if (e.pointerId === pointer_id) { zoom_to(ZOOM_LEVELS[index_at(e.clientY)]); }
		};
		const up = (/** @type {PointerEvent} */ e) => {
			if (e.pointerId !== pointer_id) { return; }
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", up);
	});
	$slider.on("keydown", (event) => {
		const keys = { ArrowUp: 1, ArrowRight: 1, PageUp: 1, ArrowDown: -1, ArrowLeft: -1, PageDown: -1 };
		if (event.key in keys) {
			step(keys[event.key]);
		} else if (event.key === "Home") {
			zoom_to(ZOOM_LEVELS[0]);
		} else if (event.key === "End") {
			zoom_to(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
		} else {
			return;
		}
		event.preventDefault();
		event.stopPropagation(); // (not the app's own shortcuts)
	});
	$slider.on("wheel", (event) => {
		const delta = /** @type {WheelEvent} */ (event.originalEvent).deltaY;
		if (!delta) { return; }
		event.preventDefault();
		step(delta < 0 ? 1 : -1);
	});
	return $slider;
})();

const airbrush_sizes = [9, 16, 24];
const $choose_airbrush_size = $Choose(
	airbrush_sizes,
	(size, is_chosen, reuse_canvas) => {

		const image_width = 72; // width of source image
		const i = airbrush_sizes.indexOf(size); // 0 or 1 or 2
		const l = airbrush_sizes.length; // 3
		const is_bottom = (i === 2);

		const shrink = is_bottom ? 0 : 4;
		const w = image_width / l - shrink * 2;
		const h = 23;
		const source_x = image_width / l * i + shrink;

		return ChooserCanvas(
			"images/options-airbrush-size.png",
			is_chosen, // invert if chosen
			w, h, // width, height of created destination canvas
			source_x, 0, w, h, // x, y, width, height from source image
			0, 0, w, h, // x, y, width, height on created destination canvas
			reuse_canvas,
		);
	},
	(size) => {
		airbrush_size = size;
	},
	(size) => size === airbrush_size,
	true,
).addClass("choose-airbrush-size");

const $choose_transparent_mode = $Choose(
	[false, true],
	(option, _is_chosen, _reuse_canvas, reuse_div) => {
		const sw = 35, sh = 23; // width, height from source image
		const b = 2; // margin by which the source image is inset on the destination
		return ChooserDiv(
			"transparent-mode-option",
			false, // never invert it
			b + sw + b, b + sh + b, // width, height of created destination canvas
			0, option ? 22 : 0, sw, sh, // x, y, width, height from source image
			b, b, sw, sh, // x, y, width, height on created destination canvas
			reuse_div,
			option, // shift y by 1px in modern theme only, for lower image; border is separate in modern theme, but shared in classic theme
		);
	},
	(option) => {
		tool_transparent_mode = option;
	},
	(option) => option === tool_transparent_mode,
	true,
).addClass("choose-transparent-mode");

// Fill With Color's tolerance: how different a color can be from the one clicked and still be filled.
// (MS Paint only has 0%. Later Paints and every other paint program have this, usually hidden in a menu.)
const FILL_TOLERANCES = [0, 10, 25, 50, 75];
const $choose_fill_tolerance = $Choose(
	FILL_TOLERANCES,
	(percent, is_chosen, _reuse_canvas, reuse_div) => {
		const div = reuse_div(39, 12);
		div.textContent = `${percent}%`;
		Object.assign(div.style, {
			color: is_chosen ? "var(--HilightText)" : "var(--WindowText)",
			font: "9px/12px Tahoma, Verdana, sans-serif",
			textAlign: "center",
		});
		return div;
	},
	(percent) => {
		set_fill_tolerance(percent);
	},
	(percent) => get_fill_tolerance() === percent,
).addClass("choose-fill-tolerance").attr("title", "Tolerance: how different a color can be and still be filled");

export {
	$ChooseShapeStyle, $choose_airbrush_size, $choose_brush,
	$choose_eraser_size, $choose_fill_tolerance, $choose_magnification, $choose_stroke_size, $choose_transparent_mode
};

