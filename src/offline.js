// @ts-check
// Registers the service worker (sw.js) that lets Paint open without a connection, then hands it the list of
// files this page loaded so it keeps those too (the first visit loads before the worker is in charge).
// Not in the desktop app (its files are on disk already), nor in the Discord activity (Discord's proxy owns
// its addresses), nor under automated tests unless a test asks for it.
import { is_discord_embed } from "./helpers.js";

/** @type {any} */
const window_any = window;

function wanted() {
	if (!("serviceWorker" in navigator) || !window.isSecureContext || !/^https?:$/.test(location.protocol)) { return false; }
	if (window_any.is_electron_app || is_discord_embed) { return false; }
	if (navigator.webdriver) {
		try {
			return localStorage.getItem("jspaint test service worker") === "on";
		} catch (_error) {
			return false;
		}
	}
	return true;
}

async function register() {
	const registration = await navigator.serviceWorker.register("sw.js", { scope: "./" });
	const worker = registration.active || registration.waiting || registration.installing;
	if (!worker) { return; }
	const send_list = (/** @type {ServiceWorker} */ to) => {
		const urls = [
			location.href.split(/[?#]/)[0],
			...performance.getEntriesByType("resource").map((entry) => entry.name),
		].filter((href) => href.startsWith(location.origin));
		to.postMessage({ type: "keep", urls });
	};
	if (worker.state === "activated") {
		send_list(worker);
	} else {
		worker.addEventListener("statechange", () => {
			if (worker.state === "activated") { send_list(worker); }
		});
	}
}

if (wanted()) {
	const start = () => {
		register().catch((error) => { console.warn("Couldn't set Paint up to work offline:", error); });
	};
	// (after the page's own loading, so it doesn't compete with it)
	if (document.readyState === "complete") {
		start();
	} else {
		window.addEventListener("load", start, { once: true });
	}
}
