// Relative to this file, so it works when the site lives under a subpath.
importScripts("servy2/servy2.sw.js");

// Images and fonts are kept in a cache, so a site's pictures show instantly the next time.
// (Every page's requests are answered here, so the browser's own HTTP cache never sees
// them.) They're stored under their real URL: servy2 passes them through unchanged, unlike
// pages, scripts and styles, which are rewritten for the tab that asked for them.
const MEDIA_CACHE = "servy-media-v1";
const MEDIA_LIMIT = 1500;
const MEDIA_MAX_SECONDS = 7 * 24 * 60 * 60;
let stores = 0;

// "https://arc4dia/~/sj/<frame>/<client>/<encoded real URL>?$..." -> the real URL.
function realUrl(request) {
	const at = request.url.indexOf("/~/sj/");
	if (at < 0) return null;
	const parts = request.url.slice(at + 6).split(/[?#]/)[0].split("/");
	if (parts.length !== 3) return null;
	try {
		const url = decodeURIComponent(parts[2]);
		return /^https?:\/\//.test(url) ? url : null;
	} catch {
		return null;
	}
}

// How long the site lets the file be kept, in seconds (0: not at all).
function keepFor(response) {
	if (response.status !== 200) return 0;
	const control = response.headers.get("cache-control") || "";
	if (/no-store|no-cache/i.test(control)) return 0;
	const maxAge = /max-age=(\d+)/i.exec(control);
	const seconds = maxAge ? Number(maxAge[1]) : response.headers.has("last-modified") ? 86400 : 3600;
	return seconds < 60 ? 0 : Math.min(seconds, MEDIA_MAX_SECONDS);
}

async function store(cache, key, response, seconds) {
	const headers = new Headers(response.headers);
	headers.set("x-servy-until", String(Date.now() + seconds * 1000));
	await cache.put(key, new Response(response.body, { status: 200, statusText: response.statusText, headers }));
	if (++stores % 100 === 0) {
		const keys = await cache.keys(); // oldest first
		await Promise.all(keys.slice(0, Math.max(0, keys.length - MEDIA_LIMIT)).map((k) => cache.delete(k)));
	}
}

async function media(event, key) {
	const cache = await caches.open(MEDIA_CACHE);
	const hit = await cache.match(key);
	if (hit && Number(hit.headers.get("x-servy-until")) > Date.now()) return hit;
	const response = await $scramjetController.route(event);
	const seconds = keepFor(response);
	if (seconds) event.waitUntil(store(cache, key, response.clone(), seconds).catch(() => {}));
	return response;
}

addEventListener("fetch", (event) => {
	if (!$scramjetController.shouldRoute(event)) return;
	const { request } = event;
	const key =
		request.method === "GET" &&
		(request.destination === "image" || request.destination === "font") &&
		!request.headers.has("range") &&
		realUrl(request);
	event.respondWith(key ? media(event, key).catch(() => $scramjetController.route(event)) : $scramjetController.route(event));
});
