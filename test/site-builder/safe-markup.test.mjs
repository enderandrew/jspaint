// The page dialect's security policies (src/safe-markup.js — one source of truth shared by the client sanitizer,
// the Workers' sanitizer, and the block model's gate). Dangerous URLs are judged by *parsing*, not prefix-matching
// (a tab inside a scheme is stripped by the browser's URL parser, which a prefix regex never saw); return paths are
// parsed and their origin compared (the parser reads `/\evil.com` as `//evil.com`); a block model keeps only the
// dialect's shapes — a `script` element becomes an inert `div`, and its `src` never lands in the model at all.
// Pure Node — no server needed.
/* eslint-disable no-script-url -- the javascript:/vbscript: strings are the attack payloads this file is about */
import { assert } from "./helpers.mjs";
import { safe_block, same_origin_path, url_is_dangerous } from "../../src/safe-markup.js";

const EDITOR = "https://edit.coolpaint.world";

// --- url_is_dangerous: the browser's URL parser is the judge ---
const dangerous = [
	"javascript:alert(1)",
	"JAVASCRIPT:alert(1)",
	"jav\tascript:alert(1)", // a tab inside the scheme: the parser strips it; the old prefix regex didn't see it
	"java\nscript:alert(1)",
	" javascript:alert(1)",
	"vbscript:msgbox(1)",
	"data:text/html,<b>hi</b>",
	"data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
	"data:application/javascript,alert(1)",
	"blob:https://example.com/xyz", // session-scoped; the pages' CSP never allowed it as anything anyway
	"coolscheme:whatever",
];
for (const value of dangerous) {
	assert.equal(url_is_dangerous(value), true, JSON.stringify(value));
}
const fine = [
	"",
	"blog/p.html",
	"/~someone/",
	"../up/one.html",
	"https://example.com/x",
	"http://example.com/x",
	"mailto:someone@example.com",
	"tel:+15551234567",
	"data:image/png;base64,iVBORw0KGgo=",
	"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'></svg>",
	"data:audio/midi,",
];
for (const value of fine) {
	assert.equal(url_is_dangerous(value), false, JSON.stringify(value));
}

// --- same_origin_path: the return-path validator (sign-in `next`, guestbook `back`) ---
assert.equal(same_origin_path("/\\evil.com", EDITOR), false, "a backslash reads as a slash: //evil.com");
assert.equal(same_origin_path("//evil.com", EDITOR), false);
assert.equal(same_origin_path("/\\evil.com/", EDITOR), false);
assert.equal(same_origin_path("https://evil.com/x", EDITOR), false);
assert.equal(same_origin_path("/\tevil", EDITOR), false, "control characters never ride along");
assert.equal(same_origin_path("/?signed_in=1&resume=save&page=index.html#local:abc123", EDITOR), true, "the query and the fragment survive");
assert.equal(same_origin_path("/~name/page.html", EDITOR), true);
assert.equal(same_origin_path("/", EDITOR), true);
assert.equal(same_origin_path("", EDITOR), false);

// --- safe_block: what the block model may hold, whatever brought it in (a tool, a parsed page, a live-room op) ---
// The attack this closes: a crafted room draft — a script element whose payload is a same-origin file (see
// block-safety.test.mjs for the room and browser halves of the story).
const crafted = safe_block({
	id: "b1",
	tag: "script",
	attrs: { src: "/api/sites/attacker/files/payload.txt" },
	html: "alert(1)",
	x: 0,
	y: 0,
	width: 100,
	height: 20,
});
assert.equal(crafted.tag, "div", "a script block becomes an inert div");
assert.deepEqual(crafted.attrs, {}, "and the src chosen for it never lands in the model");
assert.equal(crafted.html, "alert(1)", "inner HTML is untouched here; the renderer sanitizes it separately");
assert.deepEqual({ id: crafted.id, x: crafted.x, width: crafted.width }, { id: "b1", x: 0, width: 100 }, "nothing else changes");

// The rest of the dangerous set, as the block's own tag — plus names that aren't even shaped like tags
for (const tag of ["iframe", "frame", "frameset", "object", "embed", "applet", "base", "meta", "link", "noscript", "form", "input", "button", "textarea", "select", "style", "template", "svg", "math", "SCRIPT", "bad tag", ""]) {
	assert.equal(safe_block({ id: "b", tag, attrs: {}, html: "" }).tag, "div", `<${tag}> is not a block`);
}

// Unknown-but-inert tags stay (the browser treats them as inert unknown elements; new kinds need no list edit)
assert.equal(safe_block({ id: "b", tag: "x-weather", attrs: {}, html: "" }).tag, "x-weather");
assert.equal(safe_block({ id: "b", tag: "foo", attrs: {}, html: "" }).tag, "foo");

// Attributes: names are shaped, handlers and layout stay out, dangerous URLs stay out, data-* stays
const shaped = safe_block({
	id: "b",
	tag: "p",
	attrs: {
		"data-kind": "paragraph",
		href: "blog/p.html",
		onclick: "alert(1)",
		srcdoc: "<b>",
		formaction: "javascript:x",
		class: "block",
		style: "left:1px",
		contenteditable: "true",
		"bad name": "x",
		src: "javascript:alert(1)",
	},
	html: "hi",
});
assert.deepEqual(shaped.attrs, { "data-kind": "paragraph", href: "blog/p.html" }, JSON.stringify(shaped.attrs));

// A data: image source is fine; the scheme tricks are not
const as_img = (/** @type {Record<string, string>} */ attrs) => safe_block({ id: "b", tag: "img", attrs, html: "" }).attrs;
assert.equal(as_img({ src: "data:image/png;base64,iVBOR" }).src, "data:image/png;base64,iVBOR");
assert.deepEqual(as_img({ src: "javascript:alert(1)" }), {});
assert.deepEqual(as_img({ src: "jav\tascript:alert(1)" }), {}, "the tab-inside-the-scheme trick");

// A value past the cap (the registry's render_x_element slices to the same number) doesn't ride along
assert.deepEqual(safe_block({ id: "b", tag: "p", attrs: { title: "x".repeat(2001) }, html: "" }).attrs, {});
assert.equal(safe_block({ id: "b", tag: "p", attrs: { title: "x".repeat(2000) }, html: "" }).attrs.title.length, 2000);

// Non-strings can't sneak through
assert.equal(safe_block({ id: "b", tag: "p", attrs: {}, html: 42 }).html, "");
assert.deepEqual(safe_block({ id: "b", tag: "p", attrs: { href: 7 }, html: "" }).attrs, {});
assert.equal(safe_block(null), null);

console.log("safe-markup: ok");
