// Shared by Skyline's server features (AI, chat): telling browsers apart, which other
// sites may call the API, and small HTTP helpers.
//
//   AI_ALLOWED_ORIGINS  other sites allowed to call the API, comma-separated (for a
//                       static copy of Skyline hosted elsewhere)
//   TRUST_PROXY=1       behind nginx etc.: trust X-Forwarded-Proto to mark cookies Secure
//   AI_COOKIE_SECRET    signs browser IDs; without it a random one is made at start, so
//                       IDs reset when the server restarts

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_SECRET = process.env.AI_COOKIE_SECRET || randomBytes(32).toString("hex");
const COOKIE = "skyline_id";
const ALLOWED_ORIGINS = (process.env.AI_ALLOWED_ORIGINS || "")
	.split(",")
	.map((s) => s.trim().replace(/\/$/, "").toLowerCase())
	.filter(Boolean);
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const MAX_BODY = 64 * 1024;

function sign(id) {
	return createHmac("sha256", COOKIE_SECRET).update(id).digest("base64url");
}

function readCookie(req, name) {
	for (const part of String(req.headers.cookie || "").split(";")) {
		const at = part.indexOf("=");
		if (at !== -1 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
	}
	return null;
}

// "<id>.<signature>" -> id, or null if missing or tampered with.
function verify(value) {
	const [id, mac] = String(value || "").split(".");
	if (!id) return null;
	const expected = Buffer.from(sign(id));
	const given = Buffer.from(mac || "");
	return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

export function tokenFor(id) {
	return `${id}.${sign(id)}`;
}

// The browser's ID: from its signed cookie, else from the same signed token sent by the
// page (for a copy on another site, where Safari and Firefox block the cookie), else a
// new one, set as a cookie and handed back as a token.
export function browserId(req, res, token) {
	const known = verify(readCookie(req, COOKIE)) || verify(token);
	if (known) return known;
	const id = randomBytes(16).toString("base64url");
	const crossSite = Boolean(req.headers.origin && ALLOWED_ORIGINS.includes(req.headers.origin));
	const secure =
		crossSite || req.socket.encrypted || (TRUST_PROXY && req.headers["x-forwarded-proto"] === "https");
	res.setHeader(
		"Set-Cookie",
		[
			`${COOKIE}=${tokenFor(id)}`,
			"Path=/api/",
			"Max-Age=31536000",
			"HttpOnly",
			// A static copy on another site needs SameSite=None (which requires Secure).
			crossSite ? "SameSite=None" : "SameSite=Lax",
			secure ? "Secure" : "",
		]
			.filter(Boolean)
			.join("; ")
	);
	return id;
}

// Same-site requests are always fine; other sites only when listed.
export function originAllowed(req) {
	const origin = req.headers.origin;
	if (!origin) return true;
	try {
		if (new URL(origin).host === req.headers.host) return true;
	} catch {
		return false;
	}
	return ALLOWED_ORIGINS.includes(origin);
}

export function corsHeaders(req) {
	const origin = req.headers.origin;
	if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Credentials": "true",
		"Access-Control-Expose-Headers": "X-AI-Remaining, X-AI-Limit",
		Vary: "Origin",
	};
}

export function sendJson(req, res, status, body, extra = {}) {
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		...corsHeaders(req),
		...extra,
	});
	res.end(JSON.stringify(body));
}

export function readBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY) {
				reject(new Error("too large"));
				req.destroy();
			} else chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}
