// The Windows 93 build (scripts/build-w93.mjs, src/host.js), in a stand-in host page: the host can evaluate code in
// Paint's frame (Windows 93's app framework does, and the policy used to block it with an EvalError), there's no
// Extras › Multi-User and no Firebase, no service worker, and the host opens a picture in Paint with ?open=<path>
// or iframe.contentWindow.jspaint_open(blob).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { BASE_URL, assert } from "./helpers.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
execFileSync(process.execPath, [path.join(root, "scripts/build-w93.mjs"), "w93-dist"], { stdio: "ignore" });
assert.equal(existsSync(path.join(root, "w93-dist/lib/firebase")), false, "no Firebase in the build");
assert.equal(existsSync(path.join(root, "w93-dist/sw.js")), false, "no service worker in the build");
const html = readFileSync(path.join(root, "w93-dist/index.html"), "utf8");
assert.match(html, /<meta name="jspaint-host" content="windows93">/);
assert.doesNotMatch(html.match(/<meta http-equiv="Content-Security-Policy" content="[^"]*"/)[0], /firebase/i);

// The host: a page on the same origin with Paint in a frame, opening a picture from a path (as /c/… would be)
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") { errors.push(`console: ${message.text().slice(0, 300)}`); } });
await page.goto(new URL("test/site-builder/README.md", BASE_URL).href);
const csp_violations = [];
page.on("console", (message) => { if (/Content Security Policy/.test(message.text())) { csp_violations.push(message.text()); } });
await page.evaluate(() => {
	const src = `/w93-dist/index.html?open=${encodeURIComponent("/images/icons/32x32.png")}`;
	document.body.innerHTML = `<iframe id="paint" src="${src}" style="width: 900px; height: 650px"></iframe>`;
});
const frame = await (await page.waitForSelector("#paint")).contentFrame();
await frame.waitForSelector(".main-canvas", { timeout: 60000 });
await frame.waitForFunction(() => main_canvas.width === 32 && main_canvas.height === 32, null, { timeout: 15000 });
assert.match(await frame.evaluate(() => document.title), /32x32\.png/, "opened from ?open=, with its name");

// The host evaluates code in Paint's frame (what Windows 93 does at launch): no EvalError
const evaluated = await page.evaluate(() => {
	const win = /** @type {any} */ (document.getElementById("paint")).contentWindow;
	return [win.eval("1 + 1"), new win.Function("return 2 + 2")()];
});
assert.deepEqual(evaluated, [2, 4]);
assert.deepEqual(csp_violations, [], "no policy violations");

// No Multi-User, no service worker, and a #session: address is just a document kept here
assert.equal(await frame.evaluate(() => Boolean(document.querySelector('[aria-label="Multi-User"]'))), false, "no Extras › Multi-User");
assert.equal(await frame.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);

// jspaint_open with a Blob made by the host page (as Windows 93 does with a file from its file system; it's from
// another window, so it isn't an instance of Paint's own Blob)
await frame.evaluate(() => { saved = true; }); // (no "save changes?" for the picture already open)
await page.evaluate(async () => {
	const canvas = document.createElement("canvas");
	canvas.width = 60;
	canvas.height = 40;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#0f0";
	ctx.fillRect(0, 0, 60, 40);
	const blob = await new Promise((resolve) => { canvas.toBlob(resolve, "image/png"); });
	const win = /** @type {any} */ (document.getElementById("paint")).contentWindow;
	return win.jspaint_open(blob, "green.png");
});
await frame.waitForFunction(() => main_canvas.width === 60 && main_canvas.height === 40, null, { timeout: 10000 });
assert.deepEqual(await frame.evaluate(() => [...main_ctx.getImageData(30, 20, 1, 1).data]), [0, 255, 0, 255]);
assert.match(await frame.evaluate(() => document.title), /green\.png/);

// A path that isn't there says so, rather than nothing happening
await frame.evaluate(() => { saved = true; return window.jspaint_open("/c/users/nobody/missing.jpg"); });
await frame.waitForTimeout(500);
assert.match(await frame.evaluate(() => [...document.querySelectorAll(".window")].filter((w) => w.offsetParent).map((w) => w.textContent).join("\n")), /Couldn't open \/c\/users\/nobody\/missing\.jpg/);
errors.splice(0, errors.length, ...errors.filter((e) => !/missing\.jpg|status of 404|Couldn't open/.test(e)));

await browser.close();
assert.deepEqual(errors, [], "page errors");
console.log("windows93: ok");
