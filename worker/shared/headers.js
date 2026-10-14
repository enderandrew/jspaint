// @ts-check
// The response contract for user content, in one place (docs/DESIGN.md §9, and §212's promise: uploads are "served
// with Content-Type fixed … and X-Content-Type-Options: nosniff"). Both Workers answer anything carrying a site's
// files with these: the strict page CSP (no script, ever, from any site — the sanitizer is the wall, this is the
// backstop), nosniff (a browser only refuses a non-JavaScript-MIME response *for a script destination* when
// nosniff is set — without it a `.txt` on the same origin can be pulled in as `<script src>`, which is how a
// crafted room draft would have turned an uploaded file into code), no framing, no transformation (keeps
// Cloudflare's beacons off pages). The sites Worker serves pages with them; the editor's public file reads carry
// them too, so a site's files are never a script source on the editor's own origin.
const PAGE_HEADERS = {
	"Content-Security-Policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	// no-transform: Cloudflare then leaves the HTML alone — no Web Analytics beacon or other injected script on pages.
	"Cache-Control": "no-cache, no-transform",
};

export { PAGE_HEADERS };
