// Runtime settings.
// `wispServers` are the Wisp servers the browser can tunnel traffic through. All of them
// are probed when the site opens and the fastest one is used; if it stops responding,
// the next fastest takes over. Entries are a host ("example.com", tried at /wisp/ and /),
// a full URL ("wss://example.com/path/"), or "self" for this site's own /wisp/ endpoint
// (the Node server). `npm run build` drops "self" for static hosting.
// `aiEndpoint` is where Skyline AI lives: the Node server's api/ai/ by default (it holds
// the Gemini key, see src/ai.js). Static builds take AI_ENDPOINT to point at one.
self.SJ2_CONFIG = {
	aiEndpoint: "api/ai/",
	wispServers: [
		"self",
		"w2.qwq.sh",
		"api.personalloanonline.net",
		"goldenbasketballacademy.space",
		"atlantaclassical.info",
		"booksforschool.online",
		"wisp.mercurywork.shop",
	],
};
