// @ts-check
// The page dialect's security policies, in one place (docs/DESIGN.md §3, §9). Pure functions — no DOM, no Workers
// APIs — so the Paint app imports it (blocks.js, block-kinds.js) and both Workers bundle it
// (worker/shared/sanitize.js, worker/editor/page-room.js): one source of truth where these used to be three
// drifting copies (the server sanitizer, the client sanitizer, the block renderer).
//
// Two ways of deciding, on purpose. URLs and return paths are *parsed* — the browser's own URL parser is the
// judge, because a regex over the raw string is where the `javascript:` URL with a tab smuggled inside the scheme
// (which the parser strips) and the `/\evil.com` return path (a backslash the parser reads as a slash) came from.
// Element and attribute *names* are *shape-checked* — anything not executable is inert in the browser, so
// unknown-but-safe tags still render; only the dangerous set dies, and new element kinds never need a list edit.

/** Tags no page may carry, in either Worker's sanitizer: they execute, navigate away, or smuggle a document in. */
const BLOCKED_TAGS = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "applet", "base", "form", "input", "button", "textarea", "select", "meta", "link", "noscript"]);

/** Tags a block's *content* may not carry in Paint's own origin either: styles restyle the app's UI, templates carry
 * inert-but-sneaky markup. (Exactly what the client sanitizer blocked before; the page dialect keeps `style`.) */
const CONTENT_BLOCKED_TAGS = new Set([...BLOCKED_TAGS, "style", "template"]);

/** Tags a block *itself* may never be (blocks.js render() builds a live element from the model's tag): the content
 * set plus the namespace smugglers. A block with one of these renders as a `div` — inert, visible, safe. */
const BLOCK_TAG_BLOCKED = new Set([...CONTENT_BLOCKED_TAGS, "svg", "math"]);

/** Attributes that carry a URL, by name. */
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "background", "usemap", "poster", "data", "xlink:href"]);

/** Attributes any element may carry, including `<x-*>` ones: how the page positions and labels it. */
const LAYOUT_ATTRIBUTES = /^(?:class|style|id|title|data-[a-z0-9-]+)$/;

/** What the URL parser strips from anywhere in a URL before it looks at the scheme (tabs and newlines) — so a
 * scheme check that doesn't strip them first never sees what the browser will parse. */
const URL_STRIPPED = /[\t\n\r]/g;

/** Scheme prefixes a URL attribute may carry as a `data:` URL: pictures and sound, the things pages inline. */
const SAFE_DATA = /^data:(image|audio|video)\//i;

/**
 * Whether a URL attribute's value is dangerous — parsed, not prefix-matched: the value is stripped of the
 * characters the URL parser strips, then parsed, and the *scheme* is judged (relative paths and http(s)/mailto/tel
 * are fine; `data:` only as media; everything else — `javascript:`, `vbscript:`, `data:text/html`, `blob:`,
 * unknown schemes — is dangerous). `blob:` is session-scoped and meaningless on a published page anyway (the
 * pages' CSP never allowed it as an image).
 * @param {string} value
 */
function url_is_dangerous(value) {
	const text = String(value || "").replace(URL_STRIPPED, "");
	if (!text) { return false; }
	try {
		const url = new URL(text, "https://x.invalid/");
		if (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:" || url.protocol === "tel:") { return false; }
		if (url.protocol === "data:") { return !SAFE_DATA.test(text.trim()); }
		return true;
	} catch (_error) {
		return true; // unparseable but scheme-shaped: treat as dangerous
	}
}

/** A block model's tag: lowercase letters, digits, hyphens — and never one of the dangerous set. */
const BLOCK_TAG = /^[a-z][a-z0-9-]{0,31}$/;
/** A block model's attribute name (values are checked apart): lowercase-ish, hyphenated, never a handler. */
const BLOCK_ATTR = /^[a-z][a-z0-9-]{0,63}$/i;
const NEVER_BLOCK_ATTR = /^(?:on.+|srcdoc|formaction|class|style|contenteditable)$/i;
/** How long a block model's attribute value may be (the registry's render_x_element slices to this too). */
const MAX_BLOCK_ATTR = 2000;

/**
 * The block model a renderer may build from: tag and attributes within the dialect's shapes, handlers and layout
 * attributes dropped, dangerous URL values dropped. Anything outside becomes inert — an unknown-but-safe tag
 * (`foo`, `x-anything`) stays (the browser treats it as an inert unknown element); a dangerous one (`script`,
 * `iframe`, …) becomes `div`, and a block that had to change its tag loses its attributes with it: they were
 * chosen for the element it claimed to be. Pure: runs in the Worker (the room normalizes what it stores and
 * relays) and in the browser (the constructor normalizes what it renders, covering local files and rooms stored
 * before this).
 * @param {any} snapshot
 * @returns {any} a new snapshot (same fields, normalized tag/attrs/html); never null for an object input
 */
function safe_block(snapshot) {
	if (!snapshot || typeof snapshot !== "object") { return null; }
	const raw_tag = typeof snapshot.tag === "string" ? snapshot.tag : "";
	const tag = BLOCK_TAG.test(raw_tag) && !BLOCK_TAG_BLOCKED.has(raw_tag) ? raw_tag : "div";
	/** @type {Record<string, string>} */
	const attrs = {};
	if (tag === raw_tag && snapshot.attrs && typeof snapshot.attrs === "object" && !Array.isArray(snapshot.attrs)) {
		for (const [name, value] of Object.entries(snapshot.attrs)) {
			if (typeof value !== "string" || value.length > MAX_BLOCK_ATTR) { continue; }
			const lower = name.toLowerCase();
			if (!BLOCK_ATTR.test(lower) || NEVER_BLOCK_ATTR.test(lower)) { continue; }
			if (URL_ATTRIBUTES.has(lower) && url_is_dangerous(value)) { continue; }
			attrs[lower] = value;
		}
	}
	return { ...snapshot, tag, attrs, html: typeof snapshot.html === "string" ? snapshot.html : "" };
}

/**
 * Whether a return path (`next` after sign-in, `back` after a guestbook signing) is a path on the given origin —
 * parsed, then its origin compared, because the browser's URL parser reads `/\evil.com` as `//evil.com`, which a
 * syntax regex missed. Keeps the query and the fragment (`/?signed_in=1&resume=save&page=…#local:<id>`).
 * @param {string} value @param {string} origin - an origin to stay within, e.g. "https://edit.coolpaint.world"
 */
function same_origin_path(value, origin) {
	if (typeof value !== "string" || !value || /[\t\n\r]/.test(value)) { return false; }
	try {
		return new URL(value, origin).origin === origin;
	} catch (_error) {
		return false;
	}
}

export { BLOCKED_TAGS, BLOCK_TAG_BLOCKED, CONTENT_BLOCKED_TAGS, LAYOUT_ATTRIBUTES, MAX_BLOCK_ATTR, URL_ATTRIBUTES, safe_block, same_origin_path, url_is_dangerous };
