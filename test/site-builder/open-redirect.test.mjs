// The return paths, parsed instead of pattern-matched (src/safe-markup.js same_origin_path): `next` after Google
// sign-in (worker/editor/auth.js safe_next) and `back` after a guestbook signing (x-elements/guestbook.js safe_back).
// The browser's URL parser reads `/\evil.com` as `//evil.com` — which the old `^/(?!//)` regex let through — and a
// bounce straight off the sign-in is a phishing prime spot. Needs both Workers and the master key:
//   SITE_BUILDER_EDITOR_URL=http://localhost:8787 SITE_BUILDER_SITES_URL=http://localhost:8788 SITE_BUILDER_SECRET=…
// The editor's .dev.vars point Google's URLs at the fake this test runs on :8790 (as google-auth.test.mjs does).
import { createServer } from "node:http";
import { assert } from "./helpers.mjs";

const editor = (process.env.SITE_BUILDER_EDITOR_URL || "").replace(/\/+$/, "");
const sites = (process.env.SITE_BUILDER_SITES_URL || "").replace(/\/+$/, "");
const master = process.env.SITE_BUILDER_SECRET;
if (!editor || !sites || !master) {
	console.log("open-redirect: skipped (set SITE_BUILDER_EDITOR_URL, SITE_BUILDER_SITES_URL, SITE_BUILDER_SECRET)");
	process.exit(0);
}
const stamp = Date.now().toString(36);
const bearer = { Authorization: `Bearer ${master}` };

// The fake Google, in a hurry (the shape google-auth.test.mjs uses): any good code buys a token; the token names Pat
let person = { sub: `sub-${stamp}`, email: `pat-${stamp}@example.com`, email_verified: true, name: "Pat Test" };
const fake = createServer((request, response) => {
	const url = new URL(request.url || "/", "http://localhost:8790");
	if (url.pathname === "/token" && request.method === "POST") {
		let body = "";
		request.on("data", (chunk) => { body += chunk; });
		request.on("end", () => {
			const params = new URLSearchParams(body);
			const ok = params.get("code") === "good-code";
			response.writeHead(ok ? 200 : 400, { "Content-Type": "application/json" });
			response.end(JSON.stringify(ok ? { access_token: `token-${stamp}`, token_type: "Bearer" } : { error: "invalid_grant" }));
		});
		return;
	}
	if (url.pathname === "/userinfo") {
		const ok = request.headers.authorization === `Bearer token-${stamp}`;
		response.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" });
		response.end(JSON.stringify(ok ? person : { error: "bad token" }));
		return;
	}
	response.writeHead(404);
	response.end();
});
await new Promise((resolve) => { fake.listen(8790, resolve); });

/** @param {Response} response @param {string} name */
const cookie_from = (response, name) => {
	for (const line of response.headers.getSetCookie()) {
		const [pair, ...attrs] = line.split(";");
		const [key, ...rest] = pair.split("=");
		if (key === name) { return { value: decodeURIComponent(rest.join("=")), attrs: attrs.map((a) => a.trim()) }; }
	}
	return null;
};
/** @param {string} path @param {Record<string, string>} [cookies] */
const call = (path, cookies = {}) => fetch(`${editor}${path}`, { redirect: "manual", headers: { ...(Object.keys(cookies).length ? { Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ") } : {}), "Sec-Fetch-Site": "same-origin" } });

/**
 * The whole sign-in dance with one `next`: where the state cookie says we're going, and where the callback lands.
 * @param {string} next
 */
async function signed_in_with(next) {
	const start = await call(`/auth/google?next=${encodeURIComponent(next)}`);
	assert.equal(start.status, 302, await start.text());
	const state = new URL(start.headers.get("Location") || "").searchParams.get("state") || "";
	const state_cookie = cookie_from(start, "coolpaint_auth_state");
	assert.ok(state_cookie, "the state cookie is set");
	const back = await call(`/auth/google/callback?code=good-code&state=${state}`, { coolpaint_auth_state: state_cookie.value });
	assert.equal(back.status, 302, await back.text());
	return { state_cookie: state_cookie.value, location: back.headers.get("Location") || "" };
}

const site = `redirect-${stamp}`;
try {
	// The open redirect, closed: a backslash, and the classic double slash
	for (const evil of ["/\\evil.com", "//evil.com", "/\\evil.com/", "https://evil.com/x"]) {
		const { state_cookie, location } = await signed_in_with(evil);
		assert.equal(state_cookie.split("|")[1], "/", `the evil next (${JSON.stringify(evil)}) is refused before it's even kept`);
		assert.equal(location, "/", `…and the callback sends them home, not to ${JSON.stringify(evil)}`);
	}
	// A real next — query and fragment intact — still works
	const { location } = await signed_in_with("/?signed_in=1&resume=save&page=index.html#local:abc123");
	assert.equal(location, "/?signed_in=1&resume=save&page=index.html#local:abc123");

	// The guestbook's `back`, the same way: a same-origin path only, judged by the parser
	const page = "<html><head><title>back</title></head><body><h1>home</h1></body></html>";
	let response = await fetch(`${editor}/api/sites/${site}/files/index.html`, { method: "PUT", headers: { ...bearer, "Content-Type": "text/html" }, body: page });
	assert.equal(response.status, 200, await response.text());
	const sign = (/** @type {string} */ back, /** @type {string} */ ip) => fetch(`${sites}/~${site}/x/guestbook`, {
		method: "POST",
		redirect: "manual",
		headers: {
			"CF-Connecting-IP": ip,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({ name: "Pat", message: "nice site", back }),
	});
	response = await sign("/\\evil.com", `10.81.${Math.floor(Math.random() * 250)}.1`);
	assert.equal(response.status, 303, await response.text());
	assert.equal(response.headers.get("Location"), `/~${site}/#guestbook`, "a backslash back goes to the site's home, not off-site");
	response = await sign("//evil.com", `10.81.${Math.floor(Math.random() * 250)}.2`);
	assert.equal(response.headers.get("Location"), `/~${site}/#guestbook`);
	response = await sign(`/~${site}/page.html`, `10.81.${Math.floor(Math.random() * 250)}.3`);
	assert.equal(response.headers.get("Location"), `/~${site}/page.html#guestbook`, "a good back keeps its page and anchor");
} finally {
	await fetch(`${editor}/api/admin/sites/${site}`, { method: "DELETE", headers: bearer }).catch(() => {});
	fake.close();
}
console.log("open-redirect: ok");
