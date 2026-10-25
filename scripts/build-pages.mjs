#!/usr/bin/env node
// @ts-check
// Builds the static web app for GitHub Pages into `pages-dist/`.
// Only what the page loads in the browser is copied: no Electron files, build tools, tests, docs,
// localization sources, source maps, or vendored libraries' own tooling.
// (Similar to worker/build-editor.mjs, but stricter, and without the editor Worker's marker,
// so the Pages copy uses the default editor URL from src/site-constants.js.)
//
//   node scripts/build-pages.mjs [output-dir]

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.resolve(root, process.argv[2] || "pages-dist");

// Top-level files the site serves. (CNAME is left out: it's upstream's jspaint.app domain.
// A custom domain for Pages is set in the repository's Pages settings instead.)
const files = ["index.html", "about.html", "privacy.html", "favicon.ico", "manifest.webmanifest", "browserconfig.xml", "sw.js"];

// Folders and which of their files the browser uses. Paths are relative to the repository root, with "/".
/** @type {Record<string, (file: string) => boolean>} */
const folders = {
	// The app's code, minus the desktop app's main process and preload script.
	"src": (file) => !/^src\/electron-/.test(file),
	"styles": () => true,
	"images": () => true,
	"help": () => true,
	"audio": () => true,
	// Only the generated per-language bundles are loaded (src/app-localization.js);
	// the .rc sources and the scripts that convert them are build inputs.
	"localization": (file) => /^localization\/[^/]+\/localizations\.js$/.test(file),
	// Vendored libraries: just the files the app loads, plus their licenses.
	"lib": (file) =>
		/^lib\/[^/]+\.js$/.test(file) ||
		/^lib\/gif\.js\//.test(file) ||
		/^lib\/98\.css\/[^/]+\.css$/.test(file) ||
		/^lib\/os-gui\/(\$Window\.js|MenuBar\.js|parse-theme\.js|build\/)/.test(file) ||
		/^lib\/bmp-js\//.test(file) ||
		// (Firebase loads when a multi-user session starts: src/sessions.js)
		/^lib\/firebase\//.test(file) ||
		// (PDF.js loads its CMaps, fonts, color profiles and image decoders by URL: getDocument() in src/functions.js)
		/^lib\/pdf\.js\/(LICENSE$|build\/|cmaps\/|standard_fonts\/|iccs\/|wasm\/)/.test(file) ||
		// (tracky-mouse's images/ folder is for its own website and desktop app; Eye Gaze Mode only shows the logo)
		/^lib\/tracky-mouse\/(LICENSE\.txt$|core\/|images\/tracky-mouse-logo-512\.png$)/.test(file),
};

// Never shipped, wherever they are.
const never = (/** @type {string} */ file) =>
	/\.(map|psd|md|d\.ts|patch|sh)$/i.test(file) ||
	/(^|\/)\.[^/]+$/.test(file) || // dotfiles
	/(^|\/)(package(-lock)?\.json|tsconfig\.json|eslint\.config\.[cm]?js|cspell\.json)$/.test(file);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

let count = 0;
let bytes = 0;
const copy = (/** @type {string} */ relative) => {
	const target = path.join(dist, relative);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.copyFileSync(path.join(root, relative), target);
	count++;
	bytes += fs.statSync(target).size;
};

for (const file of files) {
	copy(file);
}

/** @param {string} directory */
const walk = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
	const relative = `${directory}/${entry.name}`;
	return entry.isDirectory() ? walk(relative) : [relative];
});

for (const [folder, wanted] of Object.entries(folders)) {
	for (const file of walk(folder)) {
		if (wanted(file) && !never(file)) {
			copy(file);
		}
	}
}

console.log(`${path.relative(root, dist) || "."}: ${count} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
