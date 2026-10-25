// Paint opens without a connection: a service worker (sw.js, registered by src/offline.js) keeps the app's files
// as they're fetched, and the ones the first visit loaded before it was in charge; offline, those are used.
// Only Paint's own files: the API and other addresses still go to the network.
import { assert, open_paint } from "./helpers.mjs";

const { page, errors, close } = await open_paint({
	// (it's off under automated tests unless asked for, so it can't get between the other tests and the server)
	init: () => { localStorage.setItem("jspaint test service worker", "on"); },
});

// Online: it takes charge, and keeps what the page loaded
await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
const kept = await page.waitForFunction(async () => {
	const cache = await caches.open("jspaint-offline");
	const paths = (await cache.keys()).map((request) => new URL(request.url).pathname);
	return paths.includes("/") && paths.includes("/src/app.js") && paths.includes("/styles/layout.css") && paths.length > 100 && paths;
}, null, { timeout: 30000, polling: 500 }).then((handle) => handle.jsonValue());
assert.ok(kept.some((path) => path.startsWith("/lib/")), "libraries too");
assert.ok(!kept.some((path) => path.startsWith("/api/")), "nothing from the API");

// The API isn't answered from the worker, even when it fails
const api = await page.evaluate(async () => {
	const response = await fetch("api/whoami");
	const cache = await caches.open("jspaint-offline");
	return { status: response.status, kept: Boolean(await cache.match("api/whoami")) };
});
assert.equal(api.kept, false);

// Offline: Paint still opens, and works
await page.context().setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".main-canvas", { timeout: 30000 });
await page.waitForTimeout(1500);
assert.ok(await page.evaluate(() => document.querySelectorAll(".tools-component .tool").length >= 16), "the toolbox is there");
assert.ok(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--theme-loaded").includes("classic")), "the theme loaded");
const drew = await page.evaluate(async () => {
	const { undoable } = await import("./src/functions.js");
	undoable({ name: "Offline" }, () => { main_ctx.fillStyle = "#f00"; main_ctx.fillRect(10, 10, 20, 20); });
	return [...main_ctx.getImageData(15, 15, 1, 1).data];
});
assert.deepEqual(drew, [255, 0, 0, 255]);

// An address with a query (as a site to edit or a share link has) opens the kept app too
await page.goto(`${page.url().split(/[?#]/)[0]}?from=offline-test`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".main-canvas", { timeout: 30000 });
await page.waitForTimeout(1000);

// (offline, the app's network features say they can't connect; those messages are expected here)
errors.splice(0, errors.length, ...errors.filter((e) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::|NetworkError|Failed to load resource/i.test(e)));
await page.context().setOffline(false);
await close();
console.log("offline: ok");
