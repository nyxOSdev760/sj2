// Relative to this file, so it works when the site lives under a subpath.
importScripts("controller/controller.sw.js");
/* filler: c__o__d__e */
addEventListener("fetch", (event) => {
	if ($scramjetController.shouldRoute(event)) {
		event.respondWith($scramjetController.route(event));
	}
});
