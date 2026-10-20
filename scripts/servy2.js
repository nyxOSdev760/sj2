// Builds servy2, Arc4dia's web engine, into servy2/dist/. Runs after `npm install` /
// `npm ci` (package.json "postinstall") and before every build.
//
// servy2 is a fork of Scramjet and its controller by Mercury Workshop (AGPL-3.0, see
// servy2/NOTICE): the same engine with the bugs below fixed. Each fix finds its exact spot
// in the pinned upstream build; if one can't (a different version), the build stops instead
// of shipping an engine with a fix missing. Every file is then checked to still parse.
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modules = join(root, "node_modules", "@mercuryworkshop");
const out = join(root, "servy2", "dist");

// upstream file -> servy2 file
const FILES = [
	[join(modules, "scramjet", "dist", "scramjet.js"), "servy2.js"],
	[join(modules, "scramjet", "dist", "scramjet.wasm"), "servy2.wasm"],
	[join(modules, "scramjet-controller", "dist", "controller.api.js"), "servy2.api.js"],
	[join(modules, "scramjet-controller", "dist", "controller.inject.js"), "servy2.inject.js"],
	[join(modules, "scramjet-controller", "dist", "controller.sw.js"), "servy2.sw.js"],
];

const FIXES = [
	{
		file: "servy2.js",
		name: "history.pushState/replaceState without a URL",
		// The hook turned a missing URL into the string "undefined" before checking it, so
		// `history.replaceState(state, "")` (YouTube, single-page sites) navigated to
		// ".../undefined" and showed the site's 404 page. Only rewrite a URL that was given.
		find: /\((\w+)\|\|""===\1\)&&\((\w+)\.args\[2\]=/,
		replace: (_, value, call) => `null!=${call}.args[2]&&(${call}.args[2]=`,
		near: '"History.prototype.pushState","History.prototype.replaceState"]',
	},
	{
		file: "servy2.js",
		name: "script.textContent / script.innerText",
		// Scripts were trapped on HTMLScriptElement.prototype, which has no textContent or
		// innerText of its own, so reading a script's text gave undefined and setting it did
		// nothing. Every `JSON.parse(script.textContent)` threw '"undefined" is not valid
		// JSON' (Instagram, GitHub, Next.js sites), and scripts built at runtime came out
		// empty. The Node / HTMLElement traps already handle scripts.
		find: 'e.Trap(["Node.prototype.textContent","HTMLScriptElement.prototype.textContent"]',
		replace: 'e.Trap(["Node.prototype.textContent"]',
	},
	{
		file: "servy2.js",
		name: "script.innerText",
		find: 'e.Trap(["HTMLElement.prototype.innerText","HTMLScriptElement.prototype.innerText"]',
		replace: 'e.Trap(["HTMLElement.prototype.innerText"]',
	},
	{
		file: "servy2.js",
		name: "traps on inherited properties",
		// A trap on a property the prototype only inherits (Attr.prototype.nodeValue comes
		// from Node.prototype) had no original getter or setter to call. Use the inherited one.
		find: 'let i=this.natives.call("Object.getOwnPropertyDescriptor",null,e,t),n={this:null,get:function(){return i&&i.get.call(this.this)},set:function(e){i&&i.set.call(this.this,e)}};',
		replace:
			'let i=this.natives.call("Object.getOwnPropertyDescriptor",null,e,t);for(let p=this.natives.call("Object.getPrototypeOf",null,e);!i&&p;p=this.natives.call("Object.getPrototypeOf",null,p))i=this.natives.call("Object.getOwnPropertyDescriptor",null,p,t);let n={this:null,get:function(){return i?.get?i.get.call(this.this):i?.value},set:function(e){i?.set&&i.set.call(this.this,e)}};',
	},
	{
		file: "servy2.js",
		name: "synchronous XMLHttpRequest",
		// Called a method that doesn't exist (getFlag; it's flagEnabled), so any synchronous
		// XHR threw "e.getFlag is not a function" and took the page's script down (Amazon).
		find: 'if(!e.getFlag("syncxhr"))',
		replace: 'if(!e.flagEnabled("syncxhr"))',
	},
	{
		file: "servy2.js",
		name: "localStorage.key()",
		// Returned the i-th item's value instead of its key.
		find: 'case"key":return r=>{let n=(0,i.BR)(t).filter(t=>t.startsWith(e.url.host));return t.getItem(n[r])};',
		replace:
			'case"key":return r=>{let n=(0,i.BR)(t).filter(t=>t.startsWith(e.url.host+"@"));return void 0===n[r]?null:n[r].slice(e.url.host.length+1)};',
	},
	{
		file: "servy2.js",
		name: "localStorage.length and clear()",
		// Matched every host that merely starts with this one ("x.co" took "x.com"'s keys).
		find: 'case"length":return(0,i.BR)(t).filter(t=>t.startsWith(e.url.host)).length;',
		replace: 'case"length":return(0,i.BR)(t).filter(t=>t.startsWith(e.url.host+"@")).length;',
	},
	{
		file: "servy2.js",
		name: "localStorage.clear()",
		find: 'r.startsWith(e.url.host)&&t.removeItem(r)',
		replace: 'r.startsWith(e.url.host+"@")&&t.removeItem(r)',
	},
	{
		file: "servy2.api.js",
		name: "faster script rewriting",
		// Source maps for every rewritten script only serve to give a page its functions'
		// original text back from toString(), which almost no site needs, and building them
		// made script-heavy sites (YouTube, GitHub, Roblox) load 20-60% slower.
		find: "l={flags:{...i.sb.flags,allowFailedIntercepts:!0}",
		replace: "l={flags:{...i.sb.flags,allowFailedIntercepts:!0,sourcemaps:!1}",
	},
	{
		file: "servy2.api.js",
		name: "servy2 file names",
		find: 'scramjetPath:"/scramjet/scramjet.js",injectPath:"/controller/controller.inject.js",wasmPath:"/scramjet/scramjet.wasm"',
		replace: 'scramjetPath:"/servy2/servy2.js",injectPath:"/servy2/servy2.inject.js",wasmPath:"/servy2/servy2.wasm"',
	},
];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const texts = new Map();
const upstream = new Map();
for (const [from, to] of FILES) {
	if (!to.endsWith(".js")) {
		await copyFile(from, join(out, to));
		continue;
	}
	const text = await readFile(from, "utf8");
	texts.set(to, text);
	upstream.set(to, text);
}

// The parse error a script gives (or ""). Node can be older than the browsers the engine
// targets, so an error the upstream file gives too isn't the fixes' fault.
function parseError(text, filename) {
	try {
		new vm.Script(text, { filename });
		return "";
	} catch (err) {
		return err.message;
	}
}

let failed = 0;
for (const fix of FIXES) {
	const source = texts.get(fix.file);
	const at = fix.near ? source.indexOf(fix.near) : 0;
	const span = fix.near ? 600 : source.length;
	const part = at < 0 ? "" : source.slice(at, at + span);
	const found = typeof fix.find === "string" ? part.split(fix.find).length - 1 : part.match(fix.find) ? 1 : 0;
	if (found !== 1) {
		console.error(`servy2: "${fix.name}" fix ${found ? "matched more than once" : "didn't match"} in ${fix.file}`);
		failed++;
		continue;
	}
	texts.set(fix.file, source.slice(0, at) + part.replace(fix.find, fix.replace) + source.slice(at + span));
}
if (failed) {
	console.error("servy2: upstream changed; update scripts/servy2.js for the new version.");
	process.exit(1);
}

for (const [name, text] of texts) {
	const error = parseError(text, name);
	if (error && error !== parseError(upstream.get(name), name)) {
		console.error(`servy2: ${name} doesn't parse after the fixes: ${error}`);
		process.exit(1);
	}
	await writeFile(join(out, name), text);
}
console.log(`servy2: built servy2/dist with ${FIXES.length} fixes`);
