#!/usr/bin/env node
// @ts-check
// A small static file server for running JS Paint from this folder (and for the Playwright tests), using only
// Node's built-in modules. No live reload: refresh the page after a change.
//
//   node scripts/static-server.mjs [port]      (default 1999)

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || process.env.PORT || 1999);

/** @type {Record<string, string>} */
const TYPES = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".md": "text/plain; charset=utf-8",
	".hhc": "text/html; charset=utf-8",
	".hhk": "text/html; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".gif": "image/gif",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".cur": "image/x-icon",
	".bmp": "image/bmp",
	".wav": "audio/wav",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".pfb": "application/octet-stream",
	".bcmap": "application/octet-stream",
	".icc": "application/vnd.iccprofile",
	".wasm": "application/wasm",
	".pdf": "application/pdf",
};

const server = http.createServer((request, response) => {
	if (request.method !== "GET" && request.method !== "HEAD") {
		response.writeHead(405, { Allow: "GET, HEAD" }).end();
		return;
	}
	let pathname;
	try {
		pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
	} catch {
		response.writeHead(400).end("Bad request");
		return;
	}
	// Stay inside the repository (no ../), and never serve dotfiles (.git, .env) or node_modules
	let file = path.join(root, path.normalize(pathname));
	if (!file.startsWith(root) || /(^|[/\\])(\.[^/\\]|node_modules([/\\]|$))/.test(path.relative(root, file))) {
		response.writeHead(404).end("Not found");
		return;
	}
	fs.stat(file, (error, stats) => {
		if (!error && stats.isDirectory()) {
			if (!pathname.endsWith("/")) {
				response.writeHead(301, { Location: `${pathname}/` }).end();
				return;
			}
			file = path.join(file, "index.html");
		}
		fs.stat(file, (error, stats) => {
			if (error || !stats.isFile()) {
				response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
				return;
			}
			response.writeHead(200, {
				"Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
				"Content-Length": stats.size,
				"Cache-Control": "no-cache",
			});
			if (request.method === "HEAD") {
				response.end();
				return;
			}
			fs.createReadStream(file).pipe(response);
		});
	});
});

server.listen(port, () => {
	console.log(`Serving ${root} at http://localhost:${port}/`);
});
