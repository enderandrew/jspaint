// @ts-check
/* global $status_text */

// The status bar shows where a link goes while the pointer is over it, like a browser's status bar: a linked sticker,
// web text, or element on the page (they carry the address in their tooltip, with `.has-link`), and links in the
// words of a section or text box. Leaving the link puts the status bar back.

/** @param {Element} el */
function link_of(el) {
	const linked = el.closest(".has-link[title], a[href]");
	if (!linked) { return ""; }
	return linked.getAttribute("href") || linked.getAttribute("title") || "";
}

/** @type {Element | null} */
let showing_for = null;

// (listened for on the document, so it doesn't matter whether the canvas area exists yet when this module runs)
document.addEventListener("mouseover", (event) => {
	const target = /** @type {Element} */ (event.target);
	if (!target.closest?.(".canvas-area")) { return; }
	const href = link_of(target);
	if (!href) { return; }
	showing_for = target.closest(".has-link[title], a[href]");
	$status_text.text(href);
});
document.addEventListener("mouseout", (event) => {
	if (!showing_for) { return; }
	const to = /** @type {Element | null} */ (event.relatedTarget);
	if (to && showing_for.contains(to)) { return; } // still over the same link
	showing_for = null;
	$status_text.default();
});
