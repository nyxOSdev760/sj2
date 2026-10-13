// Builds a fully static copy of the site into dist/ for hosts like GitHub Pages,
// Netlify or Cloudflare Pages. With no Node server there, the browser connects to
// an external Wisp server instead (WISP_URL, overridable per-user in Settings).
import { cp, rm, mkdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { mounts, root } from "../src/mounts.js";

const out = join(root, "dist");
const wisp = process.env.WISP_URL || "wss://wisp.mercurywork.shop/";

if (!/^wss?:\/\//.test(wisp)) {
	console.error(`WISP_URL must start with ws:// or wss:// (got "${wisp}")`);
	process.exit(1);
}

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

await writeFile(
	join(out, "config.js"),
	`self.SJ2_CONFIG = ${JSON.stringify({ wisp }, null, "\t")};\n`
);
// Stop GitHub Pages' Jekyll step from dropping files/folders it considers special.
await writeFile(join(out, ".nojekyll"), "");

console.log(`Built static site in dist/ (Wisp server: ${wisp})`);
