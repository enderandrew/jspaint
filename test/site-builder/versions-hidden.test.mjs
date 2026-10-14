// The editor's public file reads carry the sites sandbox's contract (worker/shared/headers.js): nosniff and the
// strict page CSP on every response — so a site's `.txt` (or any file) can never be pulled in as a script from the
// editor's own origin; the Fetch spec's MIME check for script destinations only applies when nosniff is set — and
// `versions/` is not public here any more than it is on the sites Worker: a page the admin hid can't be read
// through its old copies. Needs both Workers and the master key:
//   SITE_BUILDER_EDITOR_URL=http://localhost:8787 SITE_BUILDER_SITES_URL=http://localhost:8788 SITE_BUILDER_SECRET=…
import { assert } from "./helpers.mjs";

const editor = (process.env.SITE_BUILDER_EDITOR_URL || "").replace(/\/+$/, "");
const sites = (process.env.SITE_BUILDER_SITES_URL || "").replace(/\/+$/, "");
const master = process.env.SITE_BUILDER_SECRET;
if (!editor || !sites || !master) {
	console.log("versions-hidden: skipped (set SITE_BUILDER_EDITOR_URL, SITE_BUILDER_SITES_URL, SITE_BUILDER_SECRET)");
	process.exit(0);
}
const bearer = { Authorization: `Bearer ${master}` };
const site = `vh-${Date.now().toString(36)}`;
const page = (/** @type {string} */ body) => `<html><head><title>${site}</title></head><body>${body}</body></html>`;
const put = async (/** @type {string} */ path, /** @type {string} */ body, /** @type {string} */ type = "text/html") => {
	const response = await fetch(`${editor}/api/sites/${site}/files/${path}`, { method: "PUT", headers: { ...bearer, "Content-Type": type }, body });
	assert.equal(response.status, 200, `${path}: ${await response.text()}`);
};

try {
	await put("index.html", page("<h1>v1</h1>"));
	await put("index.html", page("<h1>v2</h1>")); // writing over archives the old copy under versions/
	// A text file — the payload a crafted draft would point a script element at
	await put("payload.txt", "window.__xss = 'a .txt served as a script';", "text/plain");

	// The user-content contract on the editor's public reads: nosniff + the strict CSP, whatever the file
	let response = await fetch(`${editor}/api/sites/${site}/files/payload.txt`);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("Content-Type"), "text/plain; charset=utf-8");
	assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff", "a .txt can never be mistaken for a script");
	assert.match(response.headers.get("Content-Security-Policy") || "", /default-src 'none'/, "and the page CSP rides along");
	response = await fetch(`${editor}/api/sites/${site}/files/index.html`);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
	assert.match(response.headers.get("Content-Security-Policy") || "", /script-src|default-src 'none'/);
	// …and the sites Worker answers pages with the very same contract (one header set, both Workers)
	response = await fetch(`${sites}/~${site}/`, { headers: { "CF-Connecting-IP": `10.90.${Math.floor(Math.random() * 250)}.1` } });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
	assert.match(response.headers.get("Content-Security-Policy") || "", /default-src 'none'/);

	// The saved copy under versions/ exists (the owner's Versions list)…
	const versions = (await (await fetch(`${editor}/api/sites/${site}/versions?page=index.html`, { headers: bearer })).json()).versions;
	assert.ok(versions.length >= 1, "writing over kept the earlier save");
	const stamp = versions[0].version;
	// …is the owner's (or the master's) to read…
	response = await fetch(`${editor}/api/sites/${site}/files/versions/${stamp}/index.html`, { headers: bearer });
	assert.equal(response.status, 200, await response.text());
	// …and is never public, before or after the page is hidden
	assert.equal((await fetch(`${editor}/api/sites/${site}/files/versions/${stamp}/index.html`)).status, 404, "a stranger can't read the owner's versions");

	// A hidden page: a 404 on the sites host, through the editor's public read, and through its saved copies
	const moderate = await fetch(`${editor}/api/admin/sites/${site}/moderate`, { method: "POST", headers: { ...bearer, "Content-Type": "application/json" }, body: JSON.stringify({ hide: ["index.html"] }) });
	assert.equal(moderate.status, 200, await moderate.text());
	assert.equal((await fetch(`${sites}/~${site}/`, { headers: { "CF-Connecting-IP": `10.90.${Math.floor(Math.random() * 250)}.2` } })).status, 404);
	assert.equal((await fetch(`${editor}/api/sites/${site}/files/index.html`)).status, 404, "not through the editor's public read");
	assert.equal((await fetch(`${editor}/api/sites/${site}/files/versions/${stamp}/index.html`)).status, 404, "not through its saved copies either");
	// …while the owner still can, and the payload .txt (not a page the marker hides) stays public
	assert.equal((await fetch(`${editor}/api/sites/${site}/files/versions/${stamp}/index.html`, { headers: bearer })).status, 200);
	assert.equal((await fetch(`${editor}/api/sites/${site}/files/payload.txt`)).status, 200);
} finally {
	await fetch(`${editor}/api/admin/sites/${site}`, { method: "DELETE", headers: bearer }).catch(() => {});
}
console.log("versions-hidden: ok");
