// Runtime settings.
// `wispServers` are the Wisp servers the browser can tunnel traffic through, in order of
// preference: the first one that answers is used, and if it stops responding the next one
// takes over. Entries are a host ("example.com", tried at /wisp/ and /), a full URL
// ("wss://example.com/path/"), or "self" for this site's own /wisp/ endpoint (the server
// in server/). `npm run build` drops "self" for static hosting.
self.SJ2_CONFIG = {
	// Where the ad page (ads/) is hosted, e.g. "https://ads.100math.org/". It must be a
	// different origin from this site: ads load there in sandboxed frames and can't reach
	// anything in Arc4dia. Empty: no ads.
	adsOrigin: "https://100math.org/ads/",
	wispServers: [
		"wisp.mercurywork.shop",
		// The Render server: used if Mercury is down, and for sites Mercury refuses (it
		// cuts off some, like movy.sx); the site rescue retries those through it.
		"wss://skyline-8plq.onrender.com/wisp/",
		"wss://galxy.it.com/jsonn/",
	],
};
