// Builds a fully static copy of the site into dist/ for hosts like GitHub Pages,
// Netlify or Cloudflare Pages. With no Node server there, the browser uses the external
// Wisp servers from public/config.js, or a comma-separated WISP_URL list instead.
import { createHash } from "node:crypto";
import { cp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import vm from "node:vm";
import { mounts, root } from "../src/mounts.js";
/* filler: c__o__d__e */
const out = join(root, "dist");

const context = { self: {} };
vm.runInNewContext(await readFile(join(root, "public", "config.js"), "utf8"), context);
const configured = context.self.SJ2_CONFIG.wispServers.filter((s) => s !== "self");
const wispServers = process.env.WISP_URL
	? process.env.WISP_URL.split(",").map((s) => s.trim()).filter(Boolean)
	: configured;
/* filler: c__o__d__e */
for (const server of wispServers) {
	if (!/^(wss?:\/\/)?[^\s/:]+(:\d+)?(\/\S*)?$/.test(server)) {
		console.error(`Invalid Wisp server "${server}" (use a host or a ws:// / wss:// URL)`);
		process.exit(1);
	}
}

if (!wispServers.length) {
	console.error("No Wisp servers configured");
	process.exit(1);
}
/* filler: c__o__d__e */
// Only the classic-script builds are loaded; skip ESM variants, types and sourcemaps.
function isNeeded(file) {
	if (file === "") return true;
	const top = file.split(sep)[0];
	if (top === "types" || top === "temp-types-build") return false;
	return !/\.(map|mjs|d\.ts)$|_bundled/.test(file);
}

await rm(out, { recursive: true, force: true });
for (const [prefix, dir] of mounts) {
	const dest = join(out, prefix);
	await mkdir(dest, { recursive: true });
	await cp(dir, dest, {
		recursive: true,
		filter: (src) => isNeeded(relative(dir, src)),
	});
}
/* filler: c__o__d__e */
await writeFile(
	join(out, "config.js"),
	`self.SJ2_CONFIG = ${JSON.stringify({ adsOrigin: process.env.ADS_ORIGIN ?? context.self.SJ2_CONFIG.adsOrigin ?? "", wispServers }, null, "\t")};\n`
);
// The page's own scripts and stylesheet get a version in their URLs, so a browser never
// pairs a new index.html with an old cached app.js or the other way round (GitHub Pages
// lets browsers cache files for 10 minutes, and a mixed pair breaks on startup).
const indexFile = join(out, "index.html");
let html = await readFile(indexFile, "utf8");
const own = [...html.matchAll(/\s(?:src|href)="([\w-]+\.(?:js|css))"/g)].map((m) => m[1]);
const hash = createHash("sha256");
for (const file of own) hash.update(await readFile(join(out, file)));
const version = hash.digest("hex").slice(0, 10);
html = html.replace(/(\s(?:src|href)=")([\w-]+\.(?:js|css))"/g, `$1$2?v=${version}"`);
await writeFile(indexFile, html);

// Stop GitHub Pages' Jekyll step from dropping files/folders it considers special.
await writeFile(join(out, ".nojekyll"), "");

console.log(`Built static site in dist/ (Wisp servers: ${wispServers.join(", ")})`);
