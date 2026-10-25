// Saving over a file that can't be written (disk full, read-only, in use, moved) says so, instead of giving up
// without a word; the half-written copy is thrown away, and the picture isn't marked saved.
// eslint-disable-next-line no-unused-vars
/* global enable_fs_access_api:writable */
import { assert, open_paint } from "./helpers.mjs";

const { page, errors, close } = await open_paint({
	init: () => { localStorage.setItem("jspaint confirmed overwrite capable", "true"); },
});

const save_into = (failure) => page.evaluate(async (failure) => {
	enable_fs_access_api = true; // (off by default in browsers; Paint saves over the file here, as in the desktop app)
	window.__aborted = false;
	// eslint-disable-next-line no-global-assign
	system_file_handle = {
		name: "picture.png",
		kind: "file",
		createWritable() {
			if (failure.at === "open") { return Promise.reject(new DOMException("No", failure.name)); }
			return Promise.resolve({
				write: () => (failure.at === "write" ? Promise.reject(new DOMException("No", failure.name)) : Promise.resolve()),
				close: () => Promise.resolve(),
				abort: () => { window.__aborted = true; return Promise.resolve(); },
			});
		},
	};
	saved = false;
	const { file_save } = await import("./src/functions.js");
	file_save();
	await new Promise((resolve) => { setTimeout(resolve, 800); });
	const message = [...document.querySelectorAll(".window")].filter((w) => w.offsetParent).map((w) => w.textContent).join("\n");
	[...document.querySelectorAll(".window button")].filter((b) => b.offsetParent && b.textContent.trim() === "OK").forEach((b) => b.click());
	return { message, saved, aborted: window.__aborted };
}, failure);

let result = await save_into({ at: "write", name: "QuotaExceededError" });
assert.match(result.message, /Failed to save document\. The disk may be full\./);
assert.equal(result.saved, false);
assert.equal(result.aborted, true, "the half-written copy is thrown away");

result = await save_into({ at: "open", name: "NoModificationAllowedError" });
assert.match(result.message, /read-only, or open in another program/);
assert.equal(result.saved, false);

result = await save_into({ at: "write", name: "SomethingNewError" });
assert.match(result.message, /Failed to save document\./, "an error nobody anticipated is still reported");

// A save that works is still just saved, with nothing to say
result = await save_into({ at: "never", name: "" });
assert.equal(result.saved, true);
assert.doesNotMatch(result.message, /Failed to save/);

// (show_error_message logs each failure to the console too; those are the ones expected here)
errors.splice(0, errors.length, ...errors.filter((e) => !/Failed to save document|DOMException|No$/.test(e)));
await close();
console.log("save-errors: ok");
