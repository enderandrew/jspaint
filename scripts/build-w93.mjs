#!/usr/bin/env node
// @ts-check
// Builds Paint for Windows 93 into `w93-dist/` (copy that folder into Windows 93, e.g. as /c/programs/jspaint/):
// the GitHub Pages build (scripts/build-pages.mjs), then
//  - index.html is marked <meta name="jspaint-host" content="windows93"> (src/host.js): no Extras › Multi-User,
//    no offline service worker (Windows 93's own serves /c/… files, and Paint's would get in its way);
//  - its Content-Security-Policy lets Windows 93 run code inside Paint's frame ('unsafe-eval': its app framework
//    evaluates strings there, which the policy blocked: "EvalError: Evaluating a string as JavaScript violates
//    the following Content Security Policy directive…"), and no longer names Firebase's servers;
//  - Firebase (lib/firebase/) and the service worker (sw.js) are left out.
//  - w93/app.manifest.json5 and w93/jspaint-w93.js go next to index.html. Windows 93 opens files with an app by
//    emitting "decode" on it (with a file agent), which Paint's page can't hear from inside its frame: the module
//    listens for it and calls iframe.contentWindow.jspaint_open(blob, name) (src/host.js). The manifest's `decode`
//    file types are what make Windows 93 pass files over at all (without them, double-clicking a picture opens an
//    empty Paint). ?open=<path> on the frame's address works too, for other hosts.
//
//   node scripts/build-w93.mjs [output-dir]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.resolve(root, process.argv[2] || "w93-dist");

execFileSync(process.execPath, [path.join(root, "scripts/build-pages.mjs"), dist], { stdio: "inherit" });

fs.rmSync(path.join(dist, "lib/firebase"), { recursive: true, force: true });
fs.rmSync(path.join(dist, "sw.js"), { force: true });
for (const file of ["app.manifest.json5", "jspaint-w93.js"]) {
	fs.copyFileSync(path.join(root, "w93", file), path.join(dist, file));
}

const index_path = path.join(dist, "index.html");
let html = fs.readFileSync(index_path, "utf8");
if (!html.includes('<meta charset="utf-8">')) { throw new Error("index.html: no charset meta to put the marker after"); }
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n\t<meta name="jspaint-host" content="windows93">');
// The policy itself (not the comments about it above): Windows 93's code may evaluate strings in Paint's frame,
// and Firebase's servers are gone
const csp = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/;
const match = csp.exec(html);
if (!match) { throw new Error("index.html: no Content-Security-Policy meta"); }
const without_firebase = (/** @type {string} */ sources) => sources.trim().split(/\s+/).filter((source) => source && !/firebase/i.test(source)).join(" ");
let policy = match[2];
if (!/script-src 'self'[^;]*;/.test(policy) || !/connect-src[^;]*;/.test(policy)) { throw new Error("index.html: the policy has no script-src or connect-src"); }
policy = policy.replace(/script-src 'self'([^;]*);/, (_m, rest) => `script-src 'self' 'unsafe-eval' ${without_firebase(rest)};`);
policy = policy.replace(/connect-src([^;]*);/, (_m, rest) => `connect-src ${without_firebase(rest)};`);
html = html.replace(csp, (_m, before, _old, after) => before + policy + after);
fs.writeFileSync(index_path, html);

console.log(`${path.relative(root, dist)}: for Windows 93 (no Firebase, no service worker, 'unsafe-eval' allowed, with app.manifest.json5)`);
