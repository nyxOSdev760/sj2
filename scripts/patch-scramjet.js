// Fixes a Scramjet bug, run after `npm install` / `npm ci` (package.json "postinstall").
//
// Scramjet's pushState/replaceState hook turns the optional URL argument into a string
// before checking it, so `history.replaceState(state, "")` (no URL, which single-page
// sites like YouTube and atlantic.st call all the time) navigates to ".../undefined" and
// the site shows its 404 page. The patch only rewrites the URL when one was given.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "@mercuryworkshop", "scramjet", "dist");
const HOOK = '"History.prototype.pushState","History.prototype.replaceState"]';
// `(s||""===s)&&(t.args[2]=` -> `null!=t.args[2]&&(t.args[2]=` (names differ per build)
const CHECK = /\((\w+)\|\|""===\1\)&&\((\w+)\.args\[2\]=/;

for (const name of ["scramjet.js", "scramjet.mjs", "scramjet_bundled.js", "scramjet_bundled.mjs"]) {
	const file = join(dist, name);
	let source;
	try {
		source = await readFile(file, "utf8");
	} catch {
		continue; // not in this version
	}
	const at = source.indexOf(HOOK);
	if (at < 0) {
		console.warn(`patch-scramjet: no history hook in ${name}; skipped`);
		continue;
	}
	const window = source.slice(at, at + 600);
	if (/null!=\w+\.args\[2\]&&/.test(window)) continue; // already patched
	const patched = window.replace(CHECK, (_, value, call) => `null!=${call}.args[2]&&(${call}.args[2]=`);
	if (patched === window) {
		console.warn(`patch-scramjet: history hook in ${name} looks different; skipped`);
		continue;
	}
	await writeFile(file, source.slice(0, at) + patched + source.slice(at + 600));
	console.log(`patch-scramjet: fixed pushState/replaceState without a URL in ${name}`);
}
