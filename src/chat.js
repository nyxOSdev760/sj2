// Skyline Chat: one live room for everyone on this server. The last 100 messages are kept
// in memory (a restart clears them) and pushed to browsers with server-sent events.
//
//   CHAT_ENABLED=0         turn chat off
//   CHAT_BLOCKED_WORDS     words that get a message or name rejected, comma-separated
//   CHAT_ADMIN_PASSWORD    turns on admin controls: type /admin in chat and enter it to
//                          delete messages, mute people and clear the chat

import { createHash, timingSafeEqual } from "node:crypto";
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
const ADMIN_PASSWORD = process.env.CHAT_ADMIN_PASSWORD || "";
const LOGIN_TRIES = 5; // wrong passwords per browser (and per network) every 15 minutes
const LOGIN_WINDOW = 15 * 60 * 1000;
const MAX_MUTE_MINUTES = 7 * 24 * 60;

export const chatEnabled = ENABLED;
export const chatAdminEnabled = Boolean(ADMIN_PASSWORD);

const messages = [];
let nextId = 1;
const clients = new Set(); // { res, browser }
const sent = new Map(); // browser -> times of its messages in the last minute
const admins = new Set(); // browser IDs logged in as admin (until restart or logout)
const muted = new Map(); // public tag -> time the mute ends
const failedLogins = new Map(); // "b:<browser>" / "n:<ip>" -> times of wrong passwords

setInterval(() => {
	const now = Date.now();
	for (const [browser, times] of sent) {
		const recent = times.filter((t) => now - t < 60000);
		if (recent.length) sent.set(browser, recent);
		else sent.delete(browser);
	}
	for (const [who, until] of muted) if (until <= now) muted.delete(who);
	for (const [key, times] of failedLogins) {
		const recent = times.filter((t) => now - t < LOGIN_WINDOW);
		if (recent.length) failedLogins.set(key, recent);
		else failedLogins.delete(key);
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
		`event: hello\ndata: ${JSON.stringify({
			messages,
			online: online(),
			you: tag(browser),
			token: tokenFor(browser),
			admin: admins.has(browser),
		})}\n\n`
	);
	broadcast("online", { online: online() });

	const ping = setInterval(() => res.write(": ping\n\n"), 25000);
	req.on("close", () => {
		clearInterval(ping);
		clients.delete(client);
		broadcast("online", { online: online() });
	});
}

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
	const mutedUntil = muted.get(tag(browser));
	if (mutedUntil > now) {
		const minutes = Math.ceil((mutedUntil - now) / 60000);
		return sendJson(req, res, 403, {
			error: `You're muted for ${minutes} more minute${minutes === 1 ? "" : "s"}.`,
		});
	}
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
	if (admins.has(browser)) message.admin = true;
	messages.push(message);
	if (messages.length > HISTORY) messages.shift();
	broadcast("message", message);
	sendJson(req, res, 200, { ok: true, id: message.id });
}

function network(req) {
	if (process.env.TRUST_PROXY === "1") {
		const forwarded = req.headers["x-forwarded-for"];
		if (forwarded) return String(forwarded).split(",")[0].trim();
	}
	return req.socket.remoteAddress || "unknown";
}

function passwordMatches(given) {
	const a = createHash("sha256").update(String(given)).digest();
	const b = createHash("sha256").update(ADMIN_PASSWORD).digest();
	return timingSafeEqual(a, b);
}

// /api/chat/admin/{login,logout,delete,mute,clear}
async function admin(req, res, action) {
	let body;
	try {
		body = JSON.parse(await readBody(req));
	} catch {
		return sendJson(req, res, 400, { error: "Bad request." });
	}
	const browser = browserId(req, res, typeof body.token === "string" ? body.token : null);
	if (!ADMIN_PASSWORD) return sendJson(req, res, 404, { error: "Admin controls are off on this server." });

	if (action === "login") {
		const now = Date.now();
		const keys = [`b:${browser}`, `n:${network(req)}`];
		const tries = keys.map((k) => (failedLogins.get(k) || []).filter((t) => now - t < LOGIN_WINDOW));
		if (tries.some((t) => t.length >= LOGIN_TRIES)) {
			return sendJson(req, res, 429, { error: "Too many wrong passwords. Try again in 15 minutes." });
		}
		if (typeof body.password !== "string" || !passwordMatches(body.password)) {
			keys.forEach((k, i) => failedLogins.set(k, [...tries[i], now]));
			return sendJson(req, res, 403, { error: "Wrong password." });
		}
		admins.add(browser);
		return sendJson(req, res, 200, { ok: true });
	}
	if (action === "logout") {
		admins.delete(browser);
		return sendJson(req, res, 200, { ok: true });
	}
	if (!admins.has(browser)) return sendJson(req, res, 403, { error: "You're not an admin." });

	if (action === "delete") {
		const at = messages.findIndex((m) => m.id === body.id);
		if (at === -1) return sendJson(req, res, 404, { error: "That message is already gone." });
		messages.splice(at, 1);
		broadcast("delete", { id: body.id });
	} else if (action === "mute") {
		const minutes = Math.min(Math.max(0, Number(body.minutes) || 0), MAX_MUTE_MINUTES);
		if (typeof body.from !== "string" || !body.from) return sendJson(req, res, 400, { error: "Bad request." });
		if (body.from === tag(browser)) return sendJson(req, res, 400, { error: "You can't mute yourself." });
		if (minutes) muted.set(body.from, Date.now() + minutes * 60000);
		else muted.delete(body.from);
	} else if (action === "clear") {
		messages.length = 0;
		broadcast("clear", {});
	} else {
		return sendJson(req, res, 404, { error: "Not found." });
	}
	sendJson(req, res, 200, { ok: true });
}

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
	} else if (pathname.startsWith("/api/chat/admin/") && req.method === "POST") {
		await admin(req, res, pathname.slice("/api/chat/admin/".length));
	} else {
		sendJson(req, res, 404, { error: "Not found." });
	}
	return true;
}
