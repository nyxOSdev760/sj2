// Skyline AI: relays chats to Google Gemini so the API key never reaches the browser,
// and caps how much each visitor can use.
//
// Visitors are told apart by a signed browser-ID cookie, so people sharing one Wi-Fi
// each get their own limit. (Clearing cookies gets a fresh ID and limit; the global cap
// is what protects the bill.)
//
//   GEMINI_API_KEY         required to turn AI on (keep it out of the repo)
//   GEMINI_MODEL           model, or a comma-separated list tried in order when one is
//                          overloaded or unavailable (default: see MODELS below)
//   AI_DAILY_LIMIT         messages per browser per rolling 24 hours (default 30)
//   AI_GLOBAL_DAILY_LIMIT  messages for everyone together per 24 hours (default 1000)
//   (AI_ALLOWED_ORIGINS, TRUST_PROXY and AI_COOKIE_SECRET: see visitors.js)
/* filler: c__o__d__e */
import { browserId, tokenFor, originAllowed, sendJson, readBody } from "./visitors.js";

const KEY = process.env.GEMINI_API_KEY || "";
const MODELS = (process.env.GEMINI_MODEL || "gemini-3.5-flash,gemini-flash-latest,gemini-flash-lite-latest")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);
const FIRST_BYTE_TIMEOUT = 20000;
const COOLDOWN = 5 * 60 * 1000; // skip a model this long after it fails
const coolingUntil = new Map(); // model -> time it may be tried again
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 30;
const GLOBAL_DAILY_LIMIT = Number(process.env.AI_GLOBAL_DAILY_LIMIT) || 1000;

const DAY = 24 * 60 * 60 * 1000;
const MIN_GAP = 2000; // between messages from one browser
const MAX_TURNS = 20;
const MAX_MESSAGE = 4000;
const MAX_TOTAL = 20000;

const SYSTEM = `You are Skyline AI, the assistant built into Skyline, a web browser.
Be friendly, direct and concise. Use short paragraphs, and Markdown code blocks for code.`;

export const aiEnabled = Boolean(KEY);
export const aiModel = MODELS.join(", ");
/* filler: c__o__d__e */
// browser ID -> timestamps of its messages in the last day
const usage = new Map();
let everyone = [];

setInterval(() => {
	const now = Date.now();
	for (const [key, times] of usage) {
		const recent = times.filter((t) => now - t < DAY);
		if (recent.length) usage.set(key, recent);
		else usage.delete(key);
	}
	everyone = everyone.filter((t) => now - t < DAY);
}, 60 * 60 * 1000).unref();

// Timestamps for `key` within the last day (empty lists aren't stored).
function recentUses(key, now) {
	const times = (usage.get(key) || []).filter((t) => now - t < DAY);
	if (times.length) usage.set(key, times);
	else usage.delete(key);
	return times;
}

function record(key, now) {
	const times = recentUses(key, now);
	times.push(now);
	usage.set(key, times);
}

function forget(key) {
	usage.get(key)?.pop();
}
/* filler: c__o__d__e */
function remainingFor(browser, now) {
	return Math.max(0, DAILY_LIMIT - recentUses(browser, now).length);
}

// [{role: "user"|"model", text}] ending with the user's message, or null if malformed.
function cleanMessages(value) {
	if (!Array.isArray(value) || !value.length) return null;
	const messages = value.slice(-MAX_TURNS).map((m) => ({
		role: m?.role === "model" ? "model" : "user",
		text: typeof m?.text === "string" ? m.text.slice(0, MAX_MESSAGE) : "",
	}));
	if (messages.at(-1).role !== "user" || !messages.at(-1).text.trim()) return null;
	// Keep the newest messages that fit in MAX_TOTAL characters.
	let total = 0;
	let start = messages.length;
	while (start > 0 && total + messages[start - 1].text.length <= MAX_TOTAL) {
		total += messages[--start].text.length;
	}
	const kept = messages.slice(start);
	// Gemini wants the conversation to start with the user.
	while (kept.length && kept[0].role !== "user") kept.shift();
	return kept;
}

// Tries each model in turn; overloaded, missing or silent models fall through to the
// next. Returns a streaming response, or null if none answered.
async function askGemini(messages, signal) {
	const body = JSON.stringify({
		systemInstruction: { parts: [{ text: SYSTEM }] },
		contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
		generationConfig: { maxOutputTokens: 2048 },
	});
	// Models that failed recently go last instead of making everyone wait on them.
	const now = Date.now();
	const order = [...MODELS].sort((a, b) => (coolingUntil.get(a) > now) - (coolingUntil.get(b) > now));
	for (const model of order) {
		if (signal.aborted) return null;
		// Abort if this model doesn't start answering in time; once it does, the reply can
		// stream for as long as it needs (until the visitor leaves).
		const attempt = new AbortController();
		const stop = () => attempt.abort();
		signal.addEventListener("abort", stop, { once: true });
		const timer = setTimeout(stop, FIRST_BYTE_TIMEOUT);
		try {
			const response = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
				{
					method: "POST",
					signal: attempt.signal,
					headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
					body,
				}
			);
			clearTimeout(timer);
			if (response.ok && response.body) {
				coolingUntil.delete(model);
				return response;
			}
			coolingUntil.set(model, Date.now() + COOLDOWN);
			const detail = await response.text().catch(() => "");
			console.error(`Gemini ${model} returned ${response.status}: ${detail.slice(0, 200).replace(/\s+/g, " ")}`);
			// A rejected key won't work on another model either.
			if (response.status === 401 || response.status === 403) return { keyRejected: true };
			if (response.status === 400) return null;
		} catch (err) {
			clearTimeout(timer);
			if (signal.aborted) return null;
			coolingUntil.set(model, Date.now() + COOLDOWN);
			console.error(`Gemini ${model} failed: ${err.name === "AbortError" ? "no answer in time" : err.message}`);
		}
	}
	return null;
}

async function chat(req, res) {
	if (!aiEnabled) return sendJson(req, res, 503, { error: "AI isn't set up on this server." });

	let messages;
	let token;
	try {
		const body = JSON.parse(await readBody(req));
		messages = cleanMessages(body.messages);
		token = typeof body.token === "string" ? body.token : null;
	} catch {
		messages = null;
	}
	if (!messages?.length) return sendJson(req, res, 400, { error: "Bad request." });
/* filler: c__o__d__e */
	const now = Date.now();
	const browser = browserId(req, res, token);
	const mine = recentUses(browser, now);
	everyone = everyone.filter((t) => now - t < DAY);
	const limitHeaders = { "X-AI-Remaining": "0", "X-AI-Limit": String(DAILY_LIMIT) };
	if (mine.length >= DAILY_LIMIT) {
		return sendJson(
			req,
			res,
			429,
			{ error: `You've used all ${DAILY_LIMIT} AI messages for today.`, resetAt: mine[0] + DAY },
			limitHeaders
		);
	}
	if (mine.length && now - mine.at(-1) < MIN_GAP) {
		return sendJson(req, res, 429, { error: "Slow down a little and try again." });
	}
	if (everyone.length >= GLOBAL_DAILY_LIMIT) {
		return sendJson(req, res, 429, { error: "Skyline AI is out of messages for today. Try again tomorrow." });
	}
	record(browser, now);
	everyone.push(now);
	const remaining = remainingFor(browser, now);

	const upstream = new AbortController();
	res.on("close", () => upstream.abort());

	const response = await askGemini(messages, upstream.signal);
	if (upstream.signal.aborted) return;
	if (!response || response.keyRejected) {
		// Nothing was produced, so give the message back.
		forget(browser);
		everyone.pop();
		if (response?.keyRejected) console.error("Gemini rejected GEMINI_API_KEY; set a valid key.");
		return sendJson(req, res, 502, {
			error: response?.keyRejected
				? "The AI isn't set up right on this server (its API key was rejected)."
				: "The AI is busy right now. Try again in a moment.",
		});
	}

	res.writeHead(200, {
		"Content-Type": "text/plain; charset=utf-8",
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
		"X-AI-Remaining": String(remaining),
		"X-AI-Limit": String(DAILY_LIMIT),
		...corsHeaders(req),
	});

	// Server-sent events from Gemini -> plain text chunks to the browser.
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		for await (const chunk of response.body) {
			buffer += decoder.decode(chunk, { stream: true });
			let newline;
			while ((newline = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				if (!line.startsWith("data:")) continue;
				try {
					const data = JSON.parse(line.slice(5));
					const text = (data.candidates?.[0]?.content?.parts || [])
						.filter((p) => !p.thought)
						.map((p) => p.text || "")
						.join("");
					if (text) res.write(text);
					if (data.candidates?.[0]?.finishReason === "SAFETY") {
						res.write("\n\n_(Stopped by the AI's safety filter.)_");
					}
				} catch {
					// partial or non-JSON line; skip
				}
			}
		}
	} catch (err) {
		if (!upstream.signal.aborted) console.error("Gemini stream failed:", err.message);
	}
	res.end();
}
/* filler: c__o__d__e */
// Handles /api/ai/*; returns false for other paths.
export async function handleAi(req, res, pathname) {
	if (!pathname.startsWith("/api/ai/")) return false;
	if (!originAllowed(req)) {
		sendJson(req, res, 403, { error: "Not allowed from this site." });
		return true;
	}
	if (pathname === "/api/ai/status" && req.method === "GET") {
		const token = new URL(req.url, "http://localhost").searchParams.get("token");
		const browser = browserId(req, res, token);
		sendJson(req, res, 200, {
			enabled: aiEnabled,
			limit: DAILY_LIMIT,
			remaining: aiEnabled ? remainingFor(browser, Date.now()) : DAILY_LIMIT,
			token: tokenFor(browser),
		});
	} else if (pathname === "/api/ai/chat" && req.method === "POST") {
		await chat(req, res);
	} else {
		sendJson(req, res, 404, { error: "Not found." });
	}
	return true;
}
