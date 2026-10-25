// Blocks are only ever the dialect's shapes, at every gate (src/safe-markup.js safe_block): the live room stores
// and relays a normalized model (a crafted draft — a `script` element, its payload a same-origin file — reaches
// no client, not even as history), and Paint's own constructor does the same on the way in, so a crafted *local*
// page (File › Open) renders an inert div where its author wrote a script element. Two halves:
//   the room: needs the editor Worker (SITE_BUILDER_EDITOR_URL, SITE_BUILDER_SECRET) — skipped otherwise;
//   the browser: needs the app (JSPAINT_URL, the same as every UI test).
import { assert, open_paint } from "./helpers.mjs";

const editor = (process.env.SITE_BUILDER_EDITOR_URL || "").replace(/\/+$/, "");
const master = process.env.SITE_BUILDER_SECRET;

/** A WebSocket client that can await a message type. @param {string} url */
function connect(url) {
	const ws = new WebSocket(url);
	const queue = [];
	const waiters = [];
	ws.addEventListener("message", (event) => {
		const message = JSON.parse(String(event.data));
		const index = waiters.findIndex((w) => w.type === message.type);
		if (index !== -1) { waiters.splice(index, 1)[0].resolve(message); } else { queue.push(message); }
	});
	return {
		ws,
		opened: new Promise((resolve) => { ws.addEventListener("open", () => resolve(true)); ws.addEventListener("error", () => resolve(false)); ws.addEventListener("close", () => resolve(false)); }),
		send: (message) => ws.send(JSON.stringify(message)),
		next(type, timeout = 10000) {
			const index = queue.findIndex((m) => m.type === type);
			if (index !== -1) { return Promise.resolve(queue.splice(index, 1)[0]); }
			return new Promise((resolve, reject) => {
				const waiter = { type, resolve };
				waiters.push(waiter);
				setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error(`timed out waiting for "${type}"`)); }, timeout);
			});
		},
	};
}

// --- the room: a crafted draft is stored and relayed as the safe shapes only ---
if (editor && master) {
	const site = `unsafe-${Date.now().toString(36)}`;
	const ws_base = editor.replace(/^http/, "ws");
	const room = `${ws_base}/api/sites/${site}/rooms/index.html?token=${encodeURIComponent(master)}`;
	const a = connect(room);
	assert.equal(await a.opened, true, "the master key opens the room");
	a.send({ type: "hello", client_id: "attacker", name: "Attacker" });
	await a.next("snapshot");
	// A first draft (seed) carrying a script element whose payload is a same-origin file: the classic
	// createElement-executes-what-innerHTML-wouldn't chain, if the model ever held the tag.
	a.send({
		type: "seed",
		width: 800,
		height: 600,
		label: "crafted draft",
		layers: {
			blocks: [{ id: "b1", tag: "script", attrs: { src: "/api/sites/attacker/files/payload.txt" }, html: "alert(1)", x: 0, y: 0, width: 100, height: 20 }],
			stickers: [],
			text_layers: [],
		},
	});
	const seeded = await a.next("seeded");
	assert.ok(seeded.version > 0);
	// …and an ops message with the same idea through an iframe and a srcdoc
	a.send({ type: "ops", ops: [{ kind: "blocks", op: "set", item: { id: "b2", tag: "iframe", attrs: { srcdoc: "<script>alert(1)</script>" }, html: "" } }] });
	assert.ok((await a.next("ack")).version > seeded.version);

	// Another client joins and gets the snapshot: only the safe shapes are in the document
	const b = connect(room);
	assert.equal(await b.opened, true);
	b.send({ type: "hello", client_id: "victim", name: "Victim" });
	const snapshot = await b.next("snapshot");
	assert.deepEqual(snapshot.doc.layers.blocks.map((/** @type {any} */ block) => [block.id, block.tag]), [["b1", "div"], ["b2", "div"]], "both crafted blocks are inert divs in the stored document");
	assert.deepEqual(snapshot.doc.layers.blocks[0].attrs, {}, "the script's same-origin src never reached the model");
	assert.equal(snapshot.doc.layers.blocks[1].attrs.srcdoc, undefined, "…and a srcdoc never does");
	// The relay is normalized too: the attacker's own ops come back to everyone as the safe shapes
	a.send({ type: "ops", ops: [{ kind: "blocks", op: "set", item: { id: "b3", tag: "object", attrs: { data: "/api/sites/attacker/files/payload.txt" }, html: "" } }] });
	const relayed = await b.next("ops");
	assert.equal(relayed.ops[0].item.tag, "div", "the broadcast carries the normalized item");
	assert.deepEqual(relayed.ops[0].item.attrs, {}, "with its payload attribute dropped");
	a.ws.close(1000, "done");
	b.ws.close(1000, "done");
	console.log("block-safety (room): ok");
} else {
	console.log("block-safety (room): skipped (set SITE_BUILDER_EDITOR_URL, SITE_BUILDER_SECRET)");
}

// --- the browser: a crafted local page opens with its script element as an inert div ---
{
	const { page, errors, close } = await open_paint({
		init: () => {
			// Which documents report a blocked inline handler: Chromium 156 reports one whenever an inert parser
			// (DOMParser, a <template>) reads an on… attribute, though nothing there can run; the page itself must not
			window.__live_csp_violations = 0;
			document.addEventListener("securitypolicyviolation", (event) => {
				const target = /** @type {any} */ (event.target);
				if (target === document || target?.ownerDocument === document) { window.__live_csp_violations++; }
			}, true);
		},
	});
	await page.evaluate(() => { window.__xss = undefined; saved = true; });
	// The page is built in the browser so its bitmap is a real PNG (the canvas makes one)
	await page.evaluate(() => {
		const canvas = document.createElement("canvas");
		canvas.width = 800; canvas.height = 600;
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 800, 600);
		const bitmap = canvas.toDataURL("image/png");
		/* cspell:disable — the entity-encoded tab inside the scheme below is the payload under test */
		const html = `<!DOCTYPE html><html><head><title>crafted</title></head><body bgcolor="#ffffff">
<div class="collage" style="width:800px;height:600px;position:relative">
<img class="bitmap" src="${bitmap}" style="width:800px;height:600px;position:absolute;left:0;top:0">
<script class="block" style="left:8px;top:8px;width:300px;height:24px">window.__xss = "the script element ran";</${"" /* keep this file's own parser honest */}script>
<p class="block" style="left:8px;top:40px;width:300px;height:24px" onclick="window.__xss = 'the attribute ran'">hello <img src="jav&#x09;ascript:alert(1)" onerror="window.__xss = 'the image ran'"></p>
</div></body></html>`;
		/* cspell:enable */
		window.open_from_file(new File([html], "crafted.html", { type: "text/html" }));
	});
	await page.waitForFunction(() => document.querySelectorAll(".block-layer").length === 2, null, { timeout: 10000 });
	await page.waitForTimeout(300);

	// The script element became an inert div; nothing executed, no handlers or scheme tricks survived
	assert.equal(await page.evaluate(() => window.__xss), undefined, "nothing executed");
	assert.equal(await page.evaluate(() => document.querySelectorAll(".block-layer").length), 2);
	assert.equal(await page.evaluate(() => document.querySelector('.block-layer[data-tag="script"]')), null, "no script block exists");
	assert.equal(await page.evaluate(() => document.querySelector(".block-layer[data-tag='div'] .block-el").textContent), 'window.__xss = "the script element ran";', "the crafted block is a div carrying the script as text");
	const paragraph = await page.evaluate(() => {
		const el = document.querySelector(".block-layer[data-tag='p'] .block-el");
		const img = el.querySelector("img");
		return { onclick: el.getAttribute("onclick"), img_onerror: img?.getAttribute("onerror") ?? null, img_src: img?.getAttribute("src") ?? null };
	});
	assert.deepEqual(paragraph, { onclick: null, img_onerror: null, img_src: null }, "handlers and the javascript: URL are gone from the rendered element");
	assert.equal(await page.evaluate(() => current_history_node.blocks[0].tag), "div", "the model holds the safe tag too");
	assert.equal(await page.evaluate(() => window.__live_csp_violations), 0, "no handler was ever attached in the page itself");
	// (Chromium 156+ logs the inert parsers' reports as console errors; those are the crafted handlers being read, not run)
	errors.splice(0, errors.length, ...errors.filter((e) => !/Executing inline event handler violates the following Content Security Policy/.test(e)));
	await close();
	console.log("block-safety (browser): ok");
}
console.log("block-safety: ok");
