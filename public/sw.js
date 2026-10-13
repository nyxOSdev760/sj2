// Relative to this file, so it works when the site lives under a subpath.
importScripts("controller/controller.sw.js");

addEventListener("fetch", (event) => {
	if ($scramjetController.shouldRoute(event)) {
		event.respondWith($scramjetController.route(event));
	}
});
