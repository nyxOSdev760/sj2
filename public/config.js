// Runtime settings.
// `wispServers` are the Wisp servers the browser can tunnel traffic through, in order of
// preference: the first one that answers is used, and if it stops responding the next one
// takes over. Entries are a host ("example.com", tried at /wisp/ and /), a full URL
// ("wss://example.com/path/"), or "self" for this site's own /wisp/ endpoint (the server
// in server/). `npm run build` drops "self" for static hosting.
self.SJ2_CONFIG = {
	wispServers: [
		"self",
		"wisp.mercurywork.shop",
	],
};
