#!/usr/bin/env node
// Runs every *.test.mjs in this directory in sequence and exits non-zero if any fails.
import { spawnSync } from "node:child_process";
import { appendFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const files = readdirSync(dir).filter((name) => name.endsWith(".test.mjs")).filter((name) => only.length === 0 || only.some((part) => name.includes(part))).sort();
/** @type {string[]} */
const failures = [];
for (const file of files) {
	const started = Date.now();
	const result = spawnSync(process.execPath, [path.join(dir, file)], { stdio: "inherit" });
	const seconds = ((Date.now() - started) / 1000).toFixed(1);
	if (result.status === 0) {
		console.log(`✔ ${file} (${seconds}s)`);
	} else {
		failures.push(file);
		console.log(`✘ ${file} failed (${seconds}s)`);
	}
}
const summary = failures.length ? `${failures.length} of ${files.length} test file(s) failed: ${failures.join(", ")}` : `all ${files.length} test file(s) passed`;
console.log(summary);
// (in GitHub Actions, on the run's summary page too)
if (process.env.GITHUB_STEP_SUMMARY) {
	appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### UI tests\n\n${failures.length ? failures.map((file) => `- ✘ \`${file}\``).join("\n") : summary}\n`);
}
process.exit(failures.length ? 1 : 0);
