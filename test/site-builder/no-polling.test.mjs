// The theme and Enlarge UI follow events instead of timers: switching themes waits for the theme stylesheet's
// load event (it used to check every 15 ms), and enlarged tools and colors rescale when their size or their
// area's size changes (they used to re-measure every 200 ms, for as long as the UI was enlarged).
import { assert, open_paint } from "./helpers.mjs";

const { page, close } = await open_paint({
	init: () => {
		// Note every repeating timer and who started it
		window.__intervals = [];
		const set_interval = window.setInterval;
		window.setInterval = function (handler, delay, ...rest) {
			window.__intervals.push({ delay, stack: new Error().stack });
			return set_interval.call(this, handler, delay, ...rest);
		};
	},
});
const polling = () => page.evaluate(() => window.__intervals.filter(({ stack }) => /theme\.js|\$Component\.js/.test(stack)).length);

// A theme change: theme-load comes once the new stylesheet is in, with its properties read
const switched = await page.evaluate(async () => {
	const { set_theme } = await import("./src/theme.js");
	const loads = [];
	$(window).on("theme-load.test", () => {
		loads.push(getComputedStyle(document.documentElement).getPropertyValue("--theme-loaded").replace(/['"]+/g, "").trim());
	});
	set_theme("dark.css");
	await new Promise((resolve) => { setTimeout(resolve, 1500); });
	$(window).off("theme-load.test");
	return { loads, link: document.getElementById("theme-link").getAttribute("href"), properties: Object.keys(window.themeCSSProperties || {}).length };
});
assert.equal(switched.link, "styles/themes/dark.css");
assert.ok(switched.loads.includes("dark.css"), `theme-load once the dark theme was in: ${JSON.stringify(switched.loads)}`);
assert.ok(switched.properties > 0, "and the theme's properties were read");

// Two changes in a row: only the last one's load counts
const raced = await page.evaluate(async () => {
	const { set_theme } = await import("./src/theme.js");
	const seen = [];
	$(window).on("theme-load.test", () => { seen.push(document.getElementById("theme-link").sheet?.href.split("/").pop()); });
	set_theme("modern.css");
	set_theme("classic.css");
	await new Promise((resolve) => { setTimeout(resolve, 1500); });
	$(window).off("theme-load.test");
	return seen;
});
assert.equal(raced.at(-1), "classic.css", `the last theme wins: ${JSON.stringify(raced)}`);

// Enlarge UI: the docked tools rescale when the window gets shorter, then taller
const tools_scale = () => page.evaluate(() => {
	const transform = getComputedStyle(document.querySelector(".tools-component")).transform;
	return transform === "none" ? 1 : new DOMMatrix(transform).a;
});
await page.evaluate(() => { location.hash = "enlarge-ui"; });
await page.waitForTimeout(500);
assert.ok(await page.evaluate(() => document.body.classList.contains("enlarge-ui")));
const tall = await tools_scale();
assert.ok(tall > 1, `enlarged: ${tall}`);
await page.setViewportSize({ width: 1280, height: 420 });
await page.waitForTimeout(500);
const short = await tools_scale();
assert.ok(short < tall, `smaller in a shorter window: ${tall} → ${short}`);
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(500);
assert.ok(Math.abs(await tools_scale() - tall) < 0.01, "and back");

// Back to normal size
await page.evaluate(() => { location.hash = ""; });
await page.waitForTimeout(500);
assert.equal(await tools_scale(), 1);

assert.equal(await polling(), 0, "no repeating timers from the theme or the components");
await close();
console.log("no-polling: ok");
