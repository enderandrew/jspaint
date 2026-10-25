// @ts-check
/// <reference lib="webworker" />
// Paint's service worker: keeps a copy of the app so it opens without a connection (src/offline.js registers it).
//
// Network first: online, every file comes from the server as before (so there's no "new version" to wait for),
// and each one fetched is kept; offline, the kept copy is used. Only Paint's own files are handled — the API,
// sign-in, page addresses (edit.<domain>/~site/page) and other sites are left to the network.
// The page sends the files it loaded before this worker was in charge (the first visit), to keep those too.

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const CACHE = "jspaint-offline";
const scope = new URL(sw.registration.scope);

// Paint's own files, relative to the scope (the same set worker/editor/index.js serves as the app)
const APP_FILES = new Set(["", "index.html", "about.html", "privacy.html", "favicon.ico", "manifest.webmanifest", "browserconfig.xml"]);
const APP_DIRECTORIES = /^(src|lib|images|styles|help|audio|localization)\//;

/** @param {URL} url */
function is_app_file(url) {
	if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) { return false; }
	const path = url.pathname.slice(scope.pathname.length);
	return APP_FILES.has(path) || APP_DIRECTORIES.test(path);
}

/** @param {Response} response */
const keepable = (response) => response.ok && response.status === 200 && response.type === "basic";

sw.addEventListener("install", (event) => {
	// The app's page is kept from the start; the files it loads come from the page's list (below).
	event.waitUntil(caches.open(CACHE).then((cache) => cache.add(scope.href)).catch(() => { }).then(() => sw.skipWaiting()));
});

sw.addEventListener("activate", (event) => {
	event.waitUntil(sw.clients.claim());
});

sw.addEventListener("message", (event) => {
	if (!event.data || event.data.type !== "keep" || !Array.isArray(event.data.urls)) { return; }
	event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(event.data.urls.map(async (/** @type {unknown} */ href) => {
		if (typeof href !== "string") { return; }
		let url;
		try {
			url = new URL(href, scope);
		} catch (_error) {
			return;
		}
		if (!is_app_file(url) || await cache.match(url)) { return; }
		try {
			const response = await fetch(url); // (usually straight from the HTTP cache: the page just loaded it)
			if (keepable(response)) { await cache.put(url, response); }
		} catch (_error) { /* offline again; it'll be kept next time */ }
	}))));
});

sw.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET" || request.headers.has("Range")) { return; } // (video and audio seeking: the network's job)
	const url = new URL(request.url);
	if (!is_app_file(url)) { return; }
	event.respondWith((async () => {
		const cache = await caches.open(CACHE);
		try {
			const response = await fetch(request);
			// (a page with a query — ?site=…, ?join=… — is kept as the app's page only when it's the plain app)
			if (keepable(response) && !(request.mode === "navigate" && url.search)) {
				event.waitUntil(cache.put(request, response.clone()).catch(() => { }));
			}
			return response;
		} catch (error) {
			const kept = await cache.match(request) ||
				await cache.match(request, { ignoreSearch: true }) ||
				(request.mode === "navigate" ? await cache.match(scope.href) : undefined);
			if (kept) { return kept; }
			throw error;
		}
	})());
});
