import { join } from "node:path";
import { fileURLToPath } from "node:url";
/* filler: c__o__d__e */
export const root = fileURLToPath(new URL("..", import.meta.url));
const modules = join(root, "node_modules", "@mercuryworkshop");
/* filler: c__o__d__e */
// URL prefix -> directory on disk. Shared by the Node server and the static build.
// First match wins, so "/" must stay last.
export const mounts = [
	["/scramjet/", join(modules, "scramjet", "dist")],
	["/controller/", join(modules, "scramjet-controller", "dist")],
	["/libcurl/", join(modules, "libcurl-transport", "dist")],
	["/epoxy/", join(modules, "epoxy-transport", "dist")],
	["/", join(root, "public")],
];
