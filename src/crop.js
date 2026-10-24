// @ts-check
/* global $canvas_area, main_canvas, main_ctx, selection */

// Image › Crop to Selection (Ctrl+Shift+X, as in later versions of Paint): the picture becomes just what's selected.
// The selection is put down first (so a moved selection is cropped where it is now), then the canvas is cut to
// the selection's box, as one undoable step. Page elements keep their places on the page.

import { deselect, show_error_message, undoable } from "./functions.js";
import { get_help_folder_icon } from "./helpers.js";
import { showMessageBox } from "./msgbox.js";

export function crop_to_selection() {
	if (!selection) {
		showMessageBox({
			title: "Crop to Selection",
			iconID: "info",
			message: "Select the part of the picture you want to keep first, with the Select or Free-Form Select tool.",
		});
		return;
	}
	// The selection's box, within the canvas
	const x = Math.max(0, Math.round(selection.x));
	const y = Math.max(0, Math.round(selection.y));
	const right = Math.min(main_canvas.width, Math.round(selection.x + selection.width));
	const bottom = Math.min(main_canvas.height, Math.round(selection.y + selection.height));
	const width = right - x;
	const height = bottom - y;
	deselect(); // put the selection down where it is
	if (width < 1 || height < 1) {
		show_error_message("The selection is outside the picture, so there's nothing to crop to.");
		return;
	}
	undoable({
		name: "Crop to Selection",
		icon: get_help_folder_icon("p_cut.png"),
	}, () => {
		const image_data = main_ctx.getImageData(x, y, width, height);
		main_canvas.width = width;
		main_canvas.height = height;
		main_ctx.disable_image_smoothing();
		main_ctx.putImageData(image_data, 0, 0);
		$canvas_area.trigger("resize");
	});
}
