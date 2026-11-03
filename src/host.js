// @ts-check
// Paint inside another system: a build for one (scripts/build-w93.mjs) marks index.html with
// <meta name="jspaint-host" content="windows93">, and Paint leaves out what doesn't belong there:
// multi-user sessions (Firebase) and the offline service worker (the host's own service worker serves its files).
//
// A host opens a file in Paint either way:
//   iframe.src = "…/jspaint/index.html?open=" + encodeURIComponent("/c/users/me/pictures/cat.jpg")
//   iframe.contentWindow.jspaint_open(file_or_blob_or_url, "cat.jpg")   // returns a Promise<boolean>
// A path (like /c/…) is read from the host's own origin; a File or Blob is opened as it is.
import { open_from_file, show_error_message } from "./functions.js";

/** The system this copy of Paint was built for ("windows93"), or "" for the web app itself. */
export const host_build = document.querySelector('meta[name="jspaint-host"]')?.getAttribute("content") || "";

/** Whether Extras › Multi-User is offered (not in a build for another system: no Firebase there). */
export const multi_user_available = host_build === "";

/** Whether Paint registers its offline service worker (not inside a host, whose own service worker serves files). */
export const offline_worker_available = host_build === "";

/**
 * Opens a picture (or any file Paint opens) from the host.
 * @param {Blob | File | string | URL} input - a File or Blob, or the address of one (a path is on this origin)
 * @param {string} [name] - its file name, for a Blob or an address without one
 * @returns {Promise<boolean>} whether it was read (opening it then goes on as File › Open does)
 */
async function jspaint_open(input, name) {
	try {
		let file;
		// (by shape, not instanceof: a Blob made by the host page comes from another window, with its own Blob class)
		const blob_like = typeof input === "object" && input !== null && !(input instanceof URL) && typeof /** @type {any} */ (input).arrayBuffer === "function";
		if (blob_like) {
			const blob = /** @type {Blob} */ (input);
			const own_name = typeof /** @type {any} */ (blob).name === "string" ? /** @type {any} */ (blob).name : "";
			file = new File([await blob.arrayBuffer()], name || own_name || "untitled", { type: blob.type });
		} else {
			const url = new URL(String(input), location.origin);
			const response = await fetch(url);
			if (!response.ok) { throw new Error(`HTTP ${response.status} for ${url.pathname}`); }
			const blob = await response.blob();
			const from_path = decodeURIComponent(url.pathname.split("/").pop() || "");
			file = new File([blob], name || from_path || "untitled", { type: blob.type });
		}
		open_from_file(file);
		return true;
	} catch (error) {
		show_error_message(`Couldn't open ${name || (typeof input === "string" ? input : "the file")}.`, error);
		return false;
	}
}

/** @type {any} */ (window).jspaint_open = jspaint_open;

// ?open=<path or address>: opened once Paint has started
const open_param = new URLSearchParams(location.search).get("open");
if (open_param) {
	const start = () => { setTimeout(() => { jspaint_open(open_param); }, 0); };
	if (document.readyState === "complete") { start(); } else { window.addEventListener("load", start, { once: true }); }
}

export { jspaint_open };
