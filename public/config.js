// Runtime settings.
// `wispServers` are the Wisp servers the browser can tunnel traffic through. All of them
// are probed when the site opens and the fastest one is used; if it stops responding,
// the next fastest takes over. Entries are a host ("example.com", tried at /wisp/ and /),
// a full URL ("wss://example.com/path/"), or "self" for this site's own /wisp/ endpoint
// (the Node server). `npm run build` drops "self" for static hosting.
// `aiEndpoint` / `chatEndpoint` are where Skeld AI and Chat live: the Node server's
// api/ai/ and api/chat/ (src/ai.js, src/chat.js). Static builds take AI_ENDPOINT /
// CHAT_ENDPOINT to point at one.
self.SJ2_CONFIG = {
	aiEndpoint: "api/ai/",
	chatEndpoint: "api/chat/",
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
