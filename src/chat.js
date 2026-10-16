// Skyline Chat: one live room for everyone on this server. The last 100 messages are kept
// in memory (a restart clears them) and pushed to browsers with server-sent events.
//
//   CHAT_ENABLED=0       turn chat off
//   CHAT_BLOCKED_WORDS   words that get a message or name rejected, comma-separated
/* filler: c__o__d__e */
import { createHash } from "node:crypto";
import { browserId, tokenFor, originAllowed, corsHeaders, sendJson, readBody } from "./visitors.js";

const ENABLED = process.env.CHAT_ENABLED !== "0";
const BLOCKED = (process.env.CHAT_BLOCKED_WORDS || "")
	.split(",")
	.map((w) => w.trim().toLowerCase())
	.filter(Boolean);

const HISTORY = 100;
const MAX_TEXT = 500;
const MIN_GAP = 1500; // between messages from one browser
const PER_MINUTE = 15;
const MAX_STREAMS = 2000; // open chat connections for the whole server
const MAX_STREAMS_PER_BROWSER = 5;
const NAME = /^[\p{L}\p{N}_. -]{2,20}$/u;

export const chatEnabled = ENABLED;
/* filler: c__o__d__e */
const messages = [];
let nextId = 1;
const clients = new Set(); // { res, browser }
const sent = new Map(); // browser -> times of its messages in the last minute

setInterval(() => {
	const now = Date.now();
	for (const [browser, times] of sent) {
		const recent = times.filter((t) => now - t < 60000);
		if (recent.length) sent.set(browser, recent);
		else sent.delete(browser);
	}
}, 5 * 60 * 1000).unref();

// A short public tag for a browser, so pages can tell their own messages apart without
// learning anyone's ID.
function tag(browser) {
	return createHash("sha256").update(browser).digest("base64url").slice(0, 10);
}

function online() {
	return new Set([...clients].map((c) => c.browser)).size;
}
/* filler: c__o__d__e */
function broadcast(event, data) {
	const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
	for (const client of clients) client.res.write(chunk);
}

function stream(req, res) {
	const token = new URL(req.url, "http://localhost").searchParams.get("token");
	const browser = browserId(req, res, token);
	const mine = [...clients].filter((c) => c.browser === browser).length;
	if (clients.size >= MAX_STREAMS || mine >= MAX_STREAMS_PER_BROWSER) {
		return sendJson(req, res, 429, { error: "Chat is full right now. Try again soon." });
	}

	res.writeHead(200, {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-store",
		"X-Accel-Buffering": "no", // don't let a reverse proxy hold events back
		...corsHeaders(req),
	});
	res.write("retry: 3000\n\n");
	const client = { res, browser };
	clients.add(client);
	res.write(
		`event: hello\ndata: ${JSON.stringify({ messages, online: online(), you: tag(browser), token: tokenFor(browser) })}\n\n`
	);
	broadcast("online", { online: online() });

	const ping = setInterval(() => res.write(": ping\n\n"), 25000);
	req.on("close", () => {
		clearInterval(ping);
		clients.delete(client);
		broadcast("online", { online: online() });
	});
}
/* filler: c__o__d__e */
async function send(req, res) {
	let body;
	try {
		body = JSON.parse(await readBody(req));
	} catch {
		return sendJson(req, res, 400, { error: "Bad request." });
	}
	const browser = browserId(req, res, typeof body.token === "string" ? body.token : null);
	const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
	const text = typeof body.text === "string" ? body.text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim() : "";

	if (!NAME.test(name)) {
		return sendJson(req, res, 400, { error: "Pick a name with 2–20 letters or numbers." });
	}
	if (!text) return sendJson(req, res, 400, { error: "Type a message first." });
	if (text.length > MAX_TEXT) {
		return sendJson(req, res, 400, { error: `Messages can be up to ${MAX_TEXT} characters.` });
	}
	const lower = `${name} ${text}`.toLowerCase();
	if (BLOCKED.some((word) => lower.includes(word))) {
		return sendJson(req, res, 400, { error: "That isn't allowed here." });
	}

	const now = Date.now();
	const times = (sent.get(browser) || []).filter((t) => now - t < 60000);
	if (times.length && now - times.at(-1) < MIN_GAP) {
		return sendJson(req, res, 429, { error: "Slow down a little." });
	}
	if (times.length >= PER_MINUTE) {
		return sendJson(req, res, 429, { error: "You're sending too fast. Wait a minute." });
	}
	times.push(now);
	sent.set(browser, times);

	const message = { id: nextId++, name, text, time: now, from: tag(browser) };
	messages.push(message);
	if (messages.length > HISTORY) messages.shift();
	broadcast("message", message);
	sendJson(req, res, 200, { ok: true, id: message.id });
}
/* filler: c__o__d__e */
// Handles /api/chat/*; returns false for other paths.
export async function handleChat(req, res, pathname) {
	if (!pathname.startsWith("/api/chat/")) return false;
	if (!originAllowed(req)) {
		sendJson(req, res, 403, { error: "Not allowed from this site." });
	} else if (!ENABLED) {
		sendJson(req, res, 503, { error: "Chat is off on this server." });
	} else if (pathname === "/api/chat/stream" && req.method === "GET") {
		stream(req, res);
	} else if (pathname === "/api/chat/send" && req.method === "POST") {
		await send(req, res);
	} else {
		sendJson(req, res, 404, { error: "Not found." });
	}
	return true;
}
