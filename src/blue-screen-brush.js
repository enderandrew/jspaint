// @ts-check
/* global $status_text, brush_size:writable, current_history_node, main_ctx, selected_colors */

// Colors > Blue Screen Brush: paint with the Blue Screen of Death.
// Turning it on picks the Brush and makes the colors a pattern of the old Windows "fatal exception" screen,
// so strokes (and any other tool) paint blue-screen text. Every so often the brush itself "crashes":
// a full-screen blue screen that goes away when you press any key (nothing is lost).
// Picking any other color turns it off.

import { get_tool_by_id, select_tool } from "./functions.js";
import { $G, E, make_canvas } from "./helpers.js";
import { TOOL_BRUSH } from "./tools.js";

const BLUE = "#0000aa";
const GRAY = "#aaaaaa";
const FONT = `bold 16px "Perfect DOS VGA 437", "Lucida Console", "Courier New", monospace`;
const LINE_HEIGHT = 18;
const BRUSH_SIZE = 32; // wide enough to read the text
const FIRST_CRASH = 10; // strokes before the first crash
const CRASH_EVERY = 25; // strokes between crashes after that

const SCREEN_TEXT = [
	"",
	"   A fatal exception 0E has occurred at 0028:C0011E36 in VXD VMM(01) +",
	"   00010E36. The current brush stroke will be terminated.",
	"",
	"   *  Press any key to terminate the current brush stroke.",
	"   *  Press CTRL+ALT+DEL again to restart your painting. You will",
	"      lose any unsaved pixels in all pictures.",
	"",
	"                    Press any key to continue _",
	"",
];

/** @type {CanvasPattern | null} */
let pattern = null;
/** @type {{ foreground: string | CanvasPattern, background: string | CanvasPattern, ternary: string | CanvasPattern } | null} */
let colors_before = null;
let active = false;
let brush_size_before = 0;
let strokes = 0;
/** @type {object | null} */
let last_history_node = null;
/** @type {HTMLElement | null} */
let $crash = null;

export function is_blue_screen_brush_active() {
	return active;
}

/** One screenful of blue screen, used as a repeating tile. */
export function make_blue_screen_tile() {
	const measure = make_canvas(1, 1);
	measure.ctx.font = FONT;
	const width = Math.ceil(Math.max(...SCREEN_TEXT.map((line) => measure.ctx.measureText(line).width)) + 24);
	const height = (SCREEN_TEXT.length + 2) * LINE_HEIGHT;
	const tile = make_canvas(width, height);
	const ctx = tile.ctx;
	ctx.fillStyle = BLUE;
	ctx.fillRect(0, 0, width, height);
	ctx.font = FONT;
	ctx.textBaseline = "top";
	// the title, in inverse
	const title = " Windows ";
	const title_width = ctx.measureText(title).width;
	ctx.fillStyle = GRAY;
	ctx.fillRect((width - title_width) / 2, LINE_HEIGHT, title_width, LINE_HEIGHT);
	ctx.fillStyle = BLUE;
	ctx.fillText(title, (width - title_width) / 2, LINE_HEIGHT + 1);
	ctx.fillStyle = "#fff";
	SCREEN_TEXT.forEach((line, i) => ctx.fillText(line, 0, (i + 2) * LINE_HEIGHT + 1));
	return tile;
}

function use_blue_screen_colors() {
	pattern ??= main_ctx.createPattern(make_blue_screen_tile(), "repeat");
	selected_colors.foreground = /** @type {CanvasPattern} */ (pattern);
	selected_colors.background = /** @type {CanvasPattern} */ (pattern);
	selected_colors.ternary = /** @type {CanvasPattern} */ (pattern);
	$G.trigger("option-changed");
}

export function start_blue_screen_brush() {
	if (active) { return; }
	colors_before = { foreground: selected_colors.foreground, background: selected_colors.background, ternary: selected_colors.ternary };
	active = true;
	select_tool(get_tool_by_id(TOOL_BRUSH));
	brush_size_before = brush_size;
	brush_size = Math.max(brush_size, BRUSH_SIZE);
	use_blue_screen_colors();
	$status_text.text("Blue Screen Brush: paint responsibly. This brush has performed an illegal operation and will be shut down. Eventually.");
}

/** @param {boolean} [restore_colors] */
export function stop_blue_screen_brush(restore_colors = true) {
	if (!active) { return; }
	active = false;
	if (restore_colors && colors_before) {
		selected_colors.foreground = colors_before.foreground;
		selected_colors.background = colors_before.background;
		selected_colors.ternary = colors_before.ternary;
		$G.trigger("option-changed");
	}
	colors_before = null;
	if (brush_size_before) {
		brush_size = brush_size_before;
		brush_size_before = 0;
		$G.trigger("option-changed");
	}
	$status_text.default();
}

export function toggle_blue_screen_brush() {
	if (active) {
		stop_blue_screen_brush();
	} else {
		start_blue_screen_brush();
	}
}

/** The brush "crashes": a full-screen blue screen until any key (or click). */
export function show_crash_screen() {
	if ($crash) { return; }
	const screen = E("div");
	screen.className = "blue-screen-crash";
	screen.setAttribute("role", "alertdialog");
	screen.setAttribute("aria-label", "Fatal exception");
	screen.tabIndex = -1;
	Object.assign(screen.style, {
		position: "fixed",
		inset: "0",
		zIndex: "100000",
		background: BLUE,
		color: "#fff",
		font: FONT,
		lineHeight: `${LINE_HEIGHT}px`,
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		whiteSpace: "pre",
		cursor: "none",
	});
	const title = E("div");
	title.textContent = " Windows ";
	Object.assign(title.style, { background: GRAY, color: BLUE, marginBottom: `${LINE_HEIGHT}px` });
	const text = E("div");
	text.textContent = SCREEN_TEXT.join("\n");
	screen.append(title, text);
	document.body.append(screen);
	screen.focus();
	$crash = screen;
	const dismiss = (/** @type {Event} */ event) => {
		event.preventDefault();
		event.stopPropagation();
		window.removeEventListener("keydown", dismiss, true);
		screen.removeEventListener("pointerdown", dismiss);
		screen.remove();
		$crash = null;
		$status_text.text("Blue Screen Brush: recovered from a fatal exception. Your picture is fine. Probably.");
	};
	// after a moment, so the key or click that caused it doesn't dismiss it
	setTimeout(() => {
		window.addEventListener("keydown", dismiss, true);
		screen.addEventListener("pointerdown", dismiss);
	}, 300);
}

// Picking another color ends it; strokes with it count toward the next crash
$G.on("option-changed", () => {
	if (active && selected_colors.foreground !== pattern) {
		// keep the color just picked, and put back the others
		if (colors_before) {
			if (selected_colors.background === pattern) { selected_colors.background = colors_before.background; }
			if (selected_colors.ternary === pattern) { selected_colors.ternary = colors_before.ternary; }
		}
		stop_blue_screen_brush(false);
		$G.trigger("option-changed");
	}
});
$G.on("history-update", () => {
	const previous = last_history_node;
	last_history_node = current_history_node;
	if (!active || !previous || current_history_node.parent !== previous) { return; } // only new steps (or redo), not undo
	strokes++;
	if (strokes === FIRST_CRASH || (strokes > FIRST_CRASH && (strokes - FIRST_CRASH) % CRASH_EVERY === 0)) {
		setTimeout(show_crash_screen, 150);
	}
});
