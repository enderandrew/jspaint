// @ts-check
/* global $canvas_area, localize, main_canvas, selected_tools, selection:writable */
// Right-clicking a selection (or the canvas, with the Select or Free-Form Select tool) shows the selection's
// actions, as in Windows Vista's Paint: Cut, Copy, Paste, Clear Selection, Invert Selection, Select All;
// Copy To, Paste From; Flip/Rotate, Stretch/Skew, Crop, Invert Colors. They're the menu bar's own items
// (menus.js), so they do and enable exactly what those do. A right-drag (a selection made with the other color)
// doesn't open it; a right-click without moving does, when the button comes up.
// Also Edit › Invert Selection: everything but what's selected becomes the selection.
import { OnCanvasSelection } from "./OnCanvasSelection.js";
import { MENU_DIVIDER, show_context_menu } from "./context-menu.js";
import { TOOL_FREE_FORM_SELECT, TOOL_SELECT } from "./tools.js";
import { deselect, get_tool_by_id, select_tool, undoable } from "./functions.js";
import { get_icon_for_tool, make_canvas } from "./helpers.js";

/**
 * Edit › Invert Selection: selects everything that isn't selected (the selection is put down first). The new
 * selection is the whole picture with a hole where the old one was, like a free-form selection.
 */
function invert_selection() {
	if (!selection) { return; }
	const old = selection;
	// Where the old selection is: its outline for a free-form selection, its box otherwise
	const hole = make_canvas(main_canvas.width, main_canvas.height);
	if (old.free_form) {
		hole.ctx.drawImage(old.canvas, old.x, old.y, old.width, old.height);
	} else {
		hole.ctx.fillStyle = "#000";
		hole.ctx.fillRect(old.x, old.y, old.width, old.height);
	}
	deselect(); // (put it down where it is)
	if (!selected_tools.some((tool) => tool.id === TOOL_SELECT || tool.id === TOOL_FREE_FORM_SELECT)) {
		select_tool(get_tool_by_id(TOOL_SELECT));
	}
	undoable({
		name: localize("Invert Selection"),
		icon: get_icon_for_tool(get_tool_by_id(TOOL_FREE_FORM_SELECT)),
		soft: true,
	}, () => {
		const contents = make_canvas(main_canvas);
		contents.ctx.globalCompositeOperation = "destination-out";
		contents.ctx.drawImage(hole, 0, 0);
		selection = new OnCanvasSelection(0, 0, main_canvas.width, main_canvas.height, contents);
		selection.free_form = true;
		selection.cut_out_background();
	});
}

/** @type {Record<string, any> | null} */
let menus = null;
/** The menu bar's item with this label (without its access key), from any menu. @param {string} text */
const menu_item = (text) => {
	for (const items of Object.values(menus || {})) {
		const found = items.find((/** @type {any} */ item) => item && item.label && /** @type {any} */ (window).AccessKeys.toText(item.label).replace(/\.\.\.$/, "") === text);
		if (found) { return found; }
	}
	return null;
};

/** The right-click menu's items, in Vista's order (those this version of Paint has). */
function selection_menu_items() {
	const groups = [
		["Cut", "Copy", "Paste", "Clear Selection", "Invert Selection", "Select All"],
		["Copy To", "Paste From"],
		["Flip/Rotate", "Stretch/Skew", "Crop to Selection", "Invert Colors"],
	];
	/** @type {any[]} */
	const items = [];
	for (const group of groups) {
		const found = group.map(menu_item).filter(Boolean);
		if (!found.length) { continue; }
		if (items.length) { items.push(MENU_DIVIDER); }
		items.push(...found);
	}
	return items;
}

/**
 * Shows the selection's right-click menu at a point.
 * @param {number} client_x
 * @param {number} client_y
 */
async function show_selection_menu(client_x, client_y) {
	menus ??= (await import("./menus.js")).menus;
	return show_context_menu(selection_menu_items(), client_x, client_y);
}

/** Right-clicks on the canvas area open it (app.js calls this once the canvas area exists). */
function init_selection_menu() {
	/** Where the right button went down, while it's down, and whether a menu waits for it to come up. */
	/** @type {{ x: number, y: number, released: boolean, menu_waiting: boolean } | null} */
	let right_press = null;
	const moved = (/** @type {{ clientX: number, clientY: number }} */ event) =>
		Boolean(right_press && Math.hypot(event.clientX - right_press.x, event.clientY - right_press.y) > 4);
	$canvas_area.on("pointerdown", (event) => {
		right_press = event.button === 2 ? { x: event.clientX, y: event.clientY, released: false, menu_waiting: false } : null;
	});
	// (the browser sends contextmenu when the button goes down on Linux and macOS, and when it comes up on Windows:
	// either way the menu waits for it to come up, so a right-drag — a selection with the other color — has none)
	window.addEventListener("pointerup", (event) => {
		if (!right_press || event.button !== 2) { return; }
		right_press.released = true;
		if (right_press.menu_waiting && !moved(event)) { show_selection_menu(event.clientX, event.clientY); }
		right_press.menu_waiting = false;
	});
	$canvas_area.on("contextmenu", (event) => {
		const target = /** @type {HTMLElement} */ (event.target);
		const on_selection = Boolean(selection && selection.$el[0].contains(target));
		const selecting = selected_tools.some((tool) => tool.id === TOOL_SELECT || tool.id === TOOL_FREE_FORM_SELECT);
		const on_canvas = target.matches(".main-canvas, .helper-layer, .canvas-area");
		if (!on_selection && !(selecting && on_canvas)) { return; }
		event.preventDefault();
		if (right_press && !right_press.released) {
			right_press.menu_waiting = true;
		} else if (!moved(event)) {
			show_selection_menu(event.clientX, event.clientY);
		}
	});
}

export { init_selection_menu, invert_selection, selection_menu_items, show_selection_menu };
