// @ts-check
/* global $status_text, main_canvas, selection */

// Image > Defragment Canvas: a parody of the Windows 98 Disk Defragmenter, for your picture.
// A dialog shows the picture as a grid of "clusters" and shuffles them into order, with a progress bar that
// stalls at 99% like it should. Then every pixel is really sorted: grouped by color (hue, then lightness),
// with white and transparent "free space" at the end. Stop cancels. It's one undoable step, on the picture or selection.

import { $DialogWindow } from "./$ToolWindow.js";
import { E, get_help_folder_icon, make_canvas } from "./helpers.js";
import { apply_image_transformation } from "./image-manipulation.js";
import { showMessageBox } from "./msgbox.js";

const GRID_COLUMNS = 48;
const GRID_ROWS = 18;
const CELL = 8; // px per cluster in the dialog
const DURATION = 5000; // ms to sort the clusters
const STALL = 1200; // ms stuck at 99%, for authenticity
const FREE_SPACE = 0xffff;

let busy = false;

/**
 * The sort key for a color: by hue (in 24 bands, grays first), then lightness; white and transparent pixels are free space, last.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 */
export function cluster_key(r, g, b, a) {
	if (a < 128 || (r > 245 && g > 245 && b > 245)) { return FREE_SPACE; }
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const lightness = (max + min) >> 1;
	if (max - min < 24) { return lightness; } // grays, dark to light
	let hue;
	if (max === r) {
		hue = ((g - b) / (max - min) + 6) % 6;
	} else if (max === g) {
		hue = (b - r) / (max - min) + 2;
	} else {
		hue = (r - g) / (max - min) + 4;
	}
	return 256 * (1 + Math.floor(hue * 4)) + lightness;
}

/**
 * Sorts the pixels of a canvas by cluster_key(), into another canvas of the same size.
 * @param {HTMLCanvasElement & { ctx: CanvasRenderingContext2D }} source
 * @param {CanvasRenderingContext2D} target_ctx
 */
export function defragment_pixels(source, target_ctx) {
	const image_data = source.ctx.getImageData(0, 0, source.width, source.height);
	const pixels = new Uint32Array(image_data.data.buffer);
	const bytes = image_data.data;
	// pack the key above the 32-bit pixel in a float64, so a plain numeric sort does it (stable and fast)
	const packed = new Float64Array(pixels.length);
	for (let i = 0; i < pixels.length; i++) {
		const key = cluster_key(bytes[i * 4], bytes[i * 4 + 1], bytes[i * 4 + 2], bytes[i * 4 + 3]);
		packed[i] = key * 4294967296 + pixels[i];
	}
	packed.sort();
	for (let i = 0; i < pixels.length; i++) {
		pixels[i] = packed[i] % 4294967296;
	}
	target_ctx.putImageData(image_data, 0, 0);
}

/**
 * The picture (or selection) as a grid of average colors, one per cluster.
 * @param {HTMLCanvasElement} source
 * @returns {{ color: string, key: number }[]}
 */
function read_clusters(source) {
	const small = make_canvas(GRID_COLUMNS, GRID_ROWS);
	small.ctx.imageSmoothingEnabled = true;
	small.ctx.imageSmoothingQuality = "high";
	small.ctx.drawImage(source, 0, 0, GRID_COLUMNS, GRID_ROWS);
	const d = small.ctx.getImageData(0, 0, GRID_COLUMNS, GRID_ROWS).data;
	const clusters = [];
	for (let i = 0; i < d.length; i += 4) {
		const key = cluster_key(d[i], d[i + 1], d[i + 2], d[i + 3]);
		clusters.push({ color: key === FREE_SPACE ? "#fff" : `rgb(${d[i]}, ${d[i + 1]}, ${d[i + 2]})`, key });
	}
	return clusters;
}

export function show_defragment_dialog() {
	if (busy) { return; }
	busy = true;
	const source = selection ? selection.source_canvas : main_canvas;
	const clusters = read_clusters(source);
	const total = clusters.length;
	const target_order = [...clusters].sort((a, b) => a.key - b.key);

	const $w = $DialogWindow("Defragmenting Canvas");
	$w.addClass("defragment-window");
	$w.$main.css({ padding: "8px", display: "flex", flexDirection: "column", gap: "6px" });
	const grid = make_canvas(GRID_COLUMNS * CELL, GRID_ROWS * CELL);
	$(grid).addClass("inset-deep").css({ display: "block", background: "#fff" }).appendTo($w.$main);
	const $legend = $(E("div")).css({ display: "flex", gap: "12px", fontSize: "11px" }).appendTo($w.$main);
	for (const [color, label] of [["#00a", "Optimized"], ["#f00", "Reading"], ["#0c0", "Writing"], ["#fff", "Free space"]]) {
		$(E("span")).css({ display: "inline-flex", alignItems: "center", gap: "4px" }).append(
			$(E("span")).css({ width: "10px", height: "10px", background: color, border: "1px solid #000", display: "inline-block" }),
			document.createTextNode(label),
		).appendTo($legend);
	}
	const $status = $(E("p")).css({ margin: "4px 0 0" }).text("Reading drive information...").appendTo($w.$main);
	const $progress = $(E("progress")).attr({ max: 100, value: 0 }).css({ width: "100%" }).appendTo($w.$main);
	const $percent = $(E("p")).css({ margin: 0 }).text("0% complete").appendTo($w.$main);
	let canceled = false;
	$w.$Button("Stop", () => { $w.close(); });
	$w.on("close", () => {
		canceled = true;
		busy = false;
	});
	$w.center();

	/** @param {number} [reading] @param {number} [writing] */
	const draw = (reading = -1, writing = -1) => {
		grid.ctx.fillStyle = "#fff";
		grid.ctx.fillRect(0, 0, grid.width, grid.height);
		clusters.forEach((cluster, i) => {
			const x = (i % GRID_COLUMNS) * CELL;
			const y = Math.floor(i / GRID_COLUMNS) * CELL;
			grid.ctx.fillStyle = i === reading ? "#f00" : i === writing ? "#0c0" : cluster.color;
			grid.ctx.fillRect(x + 1, y + 1, CELL - 1, CELL - 1);
			if (i < placed && cluster.key !== FREE_SPACE) { // optimized: a blue frame
				grid.ctx.strokeStyle = "#00a";
				grid.ctx.strokeRect(x + 1.5, y + 1.5, CELL - 2, CELL - 2);
			}
		});
	};

	// A selection sort, a few swaps per tick, so you can watch the clusters move into place
	let placed = 0;
	const started = performance.now();
	let stalled_at = 0;
	const tick = () => {
		if (canceled) { return; }
		const elapsed = performance.now() - started;
		const goal = Math.min(total, Math.ceil(total * Math.min(1, elapsed / DURATION)));
		let reading = -1;
		let writing = -1;
		while (placed < goal) {
			const wanted = target_order[placed];
			const from = clusters.indexOf(wanted, placed);
			[clusters[placed], clusters[from]] = [clusters[from], clusters[placed]];
			reading = from;
			writing = placed;
			placed++;
		}
		draw(reading, writing);
		const percent = Math.min(99, Math.floor(100 * placed / total));
		$progress.attr("value", percent);
		$percent.text(`${percent}% complete`);
		$status.text(placed < total ? `Defragmenting file system... cluster ${placed.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}` : "Almost done...");
		if (placed < total) {
			setTimeout(tick, 50);
			return;
		}
		stalled_at ||= performance.now();
		if (performance.now() - stalled_at < STALL) {
			setTimeout(tick, 100);
			return;
		}
		$progress.attr("value", 100);
		$percent.text("100% complete");
		finish();
	};
	const finish = () => {
		$w.close();
		const width = source.width;
		const height = source.height;
		apply_image_transformation({
			name: "Defragment Canvas",
			icon: get_help_folder_icon("p_invert.png"),
		}, (original_canvas, _original_ctx, _new_canvas, new_ctx) => {
			defragment_pixels(/** @type {HTMLCanvasElement & { ctx: CanvasRenderingContext2D }} */ (original_canvas), new_ctx);
		});
		const pixels = (width * height).toLocaleString("en-US");
		$status_text.text(`Defragmentation complete. ${pixels} pixels are now contiguous. 0 bytes freed.`);
		showMessageBox({
			title: "Defragmenting Canvas",
			iconID: "info",
			message: `Defragmentation of your picture is complete.\n\nAll ${pixels} pixels are now stored contiguously, for faster access. You may notice a slight change in appearance.`,
		});
	};
	draw();
	setTimeout(tick, 400);
}
