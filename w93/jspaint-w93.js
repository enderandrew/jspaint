// @ts-check
// Windows 93's side of Paint (copied into the Windows 93 build by scripts/build-w93.mjs).
//
// When Windows 93 opens a file with an app (double-click, Open With, dropping it on the window), it doesn't put the
// file in the app's address: it makes a "file agent" for it and emits a "decode" event on the app. Paint's page
// can't hear that from inside its frame, so this module (the manifest's `module`, next to its `document`) listens
// for it and hands the picture to Paint with iframe.contentWindow.jspaint_open() (src/host.js).
//
// The manifest also needs a `decode` list of file types: without one, Windows 93 makes no file agents at all,
// and the app just opens empty.

/** @param {string} name */
const mime_type_for = (name) => {
	const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
	return {
		png: "image/png", webp: "image/webp", gif: "image/gif", tif: "image/tiff", tiff: "image/tiff",
		jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg", jfif: "image/jpeg", bmp: "image/bmp", dib: "image/bmp",
	}[ext] ?? "";
};

/**
 * A file agent's contents as a Blob, whichever way this version of Windows 93 offers them.
 * @param {any} file_agent
 * @param {string} name
 * @returns {Promise<Blob>}
 */
async function read_blob(file_agent, name) {
	for (const method of ["getBlob", "blob", "getFile"]) {
		if (typeof file_agent[method] === "function") { return file_agent[method](); }
	}
	for (const method of ["getArrayBuffer", "arrayBuffer"]) {
		if (typeof file_agent[method] === "function") {
			return new Blob([await file_agent[method]()], { type: mime_type_for(name) });
		}
	}
	throw new Error("This version of Windows 93 doesn't say how to read files.");
}

/**
 * @param {any} file_agent
 * @returns {string}
 */
const name_of = (file_agent) => {
	try {
		const name = file_agent.getName?.();
		if (name) { return String(name); }
	} catch { /* fall through to the path */ }
	return String(file_agent.path ?? "").split("/").pop() || "untitled";
};

/**
 * @param {any} app - Windows 93's App
 */
export function renderApp(app) {
	/** @returns {HTMLIFrameElement | null} */
	const frame = () => app.iframeEl ?? app.el?.querySelector?.("iframe") ?? null;

	// Paint takes a few seconds to start: wait until its page has loaded and jspaint_open exists
	async function paint_window(timeout_ms = 60000) {
		const give_up = Date.now() + timeout_ms;
		for (;;) {
			/** @type {any} */
			const win = frame()?.contentWindow;
			try {
				if (typeof win?.jspaint_open === "function" && win.document.readyState === "complete") { return win; }
			} catch { /* the frame is between pages */ }
			if (app.signal?.aborted) { throw new Error("Paint was closed"); }
			if (Date.now() > give_up) { throw new Error("Paint didn't start in time"); }
			await new Promise((resolve) => { setTimeout(resolve, 100); });
		}
	}

	// one file at a time, in order (several can arrive together)
	let opening = Promise.resolve();
	app.on("decode", (/** @type {any} */ file_agent) => {
		opening = opening.then(async () => {
			const name = name_of(file_agent);
			const blob = await read_blob(file_agent, name);
			const win = await paint_window();
			await new Promise((resolve) => { setTimeout(resolve, 0); }); // as ?open= does: after Paint's own load handlers
			await win.jspaint_open(blob, name);
		}).catch((error) => {
			console.error("[Paint] couldn't open the file from Windows 93:", error);
		});
	});

	// no content of our own: Windows 93 puts the manifest's `document` (index.html) in the window
	return undefined;
}
