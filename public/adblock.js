"use strict";
/* filler: c__o__d__e */
// Ad and tracker blocking through AdGuard DNS (94.140.14.14 / 94.140.15.15).
//
// AdGuard DNS answers 0.0.0.0 for ad and tracker domains. Each hostname is looked up over
// DNS-over-HTTPS (sent through the proxy's own transport, so it works on static hosts with
// any Wisp server), and requests and WebSockets to blocked hosts are refused. The biggest ad
// networks are blocked without a lookup, answers are kept in this browser for 12 hours, and
// a page load to a new host goes out alongside its lookup instead of waiting for it.
// The Node server additionally resolves every Wisp connection through AdGuard (src/index.js).
self.AdGuardDNS = (() => {
	// dns.adguard-dns.com is AdGuard's DoH endpoint on 94.140.14.14 and 94.140.15.15.
	const DOH_URL = "https://dns.adguard-dns.com/dns-query";
	const DOH_HOST = new URL(DOH_URL).hostname;
	const CACHE_MS = 10 * 60 * 1000;
	const ERROR_CACHE_MS = 30 * 1000;
	const CACHE_LIMIT = 5000;

	const cache = new Map(); // hostname -> { expires, blocked: Promise<boolean>, value? }

	// The biggest ad, tracker and pop-up networks, blocked straight away without asking
	// AdGuard (it blocks them too, except the pop-up networks at the end).
	const KNOWN_ADS = [
		"doubleclick.net", "googlesyndication.com", "googleadservices.com", "google-analytics.com",
		"googletagmanager.com", "googletagservices.com", "adservice.google.com", "adnxs.com",
		"adsrvr.org", "amazon-adsystem.com", "criteo.com", "criteo.net", "taboola.com",
		"outbrain.com", "pubmatic.com", "rubiconproject.com", "openx.net", "casalemedia.com",
		"scorecardresearch.com", "quantserve.com", "moatads.com", "adsafeprotected.com",
		"doubleverify.com", "3lift.com", "sharethrough.com", "smartadserver.com", "teads.tv",
		"bidswitch.net", "indexww.com", "media.net", "contextweb.com", "yieldmo.com",
		"advertising.com", "hotjar.com", "bat.bing.com", "ads-twitter.com", "ads.linkedin.com",
		"analytics.tiktok.com", "adform.net", "mathtag.com", "everesttech.net", "demdex.net",
		"popads.net", "popcash.net", "propellerads.com", "onclickads.net", "exoclick.com",
		"juicyads.com", "adcash.com", "a-ads.com", "adsterra.com", "profitableratecpmnetwork.com",
	];
	function listed(hostname) {
		return KNOWN_ADS.some((domain) => hostname === domain || hostname.endsWith("." + domain));
	}

	// AdGuard's answers are kept for a while in this browser, so a reload doesn't ask again.
	const SAVED_KEY = "sj2:dns";
	const SAVED_MS = 12 * 60 * 60 * 1000;
	const SAVED_LIMIT = 3000;
	let saved = {};
	try {
		saved = JSON.parse(localStorage.getItem(SAVED_KEY)) || {};
	} catch {
		saved = {};
	}
	let saveTimer = 0;
	function remember(hostname, blocked) {
		saved[hostname] = [blocked ? 1 : 0, Date.now() + SAVED_MS];
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			const now = Date.now();
			const entries = Object.entries(saved).filter(([, [, expires]]) => expires > now);
			saved = Object.fromEntries(entries.slice(-SAVED_LIMIT));
			try {
				localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
			} catch {
				// storage full or unavailable; answers just aren't kept
			}
		}, 3000);
	}

	// What's already known about `hostname`: true (blocked), false, or undefined.
	function verdict(hostname) {
		hostname = hostname.toLowerCase().replace(/\.$/, "");
		if (!hostname || hostname === DOH_HOST || isIpLiteral(hostname)) return false;
		if (listed(hostname)) return true;
		const entry = cache.get(hostname);
		if (entry && entry.expires > Date.now() && "value" in entry) return entry.value;
		const kept = saved[hostname];
		if (kept && kept[1] > Date.now()) return kept[0] === 1;
		return undefined;
	}

	function discard(response) {
		try {
			response?.body?.cancel?.()?.catch?.(() => {});
		} catch {
			// not a stream
		}
	}

	function isIpLiteral(host) {
		return host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
	}

	// RFC 1035 query for the A record of `name`, base64url-encoded for a DoH GET (RFC 8484).
	function encodeQuery(name) {
		const bytes = [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]; // id 0, recursion desired, 1 question
		for (const label of name.split(".")) {
			if (!label) continue;
			const encoded = new TextEncoder().encode(label);
			bytes.push(encoded.length, ...encoded);
		}
		bytes.push(0, 0, 1, 0, 1); // root, type A, class IN
		return btoa(String.fromCharCode(...bytes))
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
	}
/* filler: c__o__d__e */
	function skipName(view, offset) {
		while (offset < view.byteLength) {
			const len = view.getUint8(offset);
			if (len === 0) return offset + 1;
			if ((len & 0xc0) === 0xc0) return offset + 2; // compression pointer ends the name
			offset += len + 1;
		}
		throw new Error("Truncated DNS name");
	}

	// Returns the IPv4 addresses in the answer section of a DNS response.
	function parseAddresses(buffer) {
		const view = new DataView(buffer);
		if (view.byteLength < 12) throw new Error("Truncated DNS response");
		const rcode = view.getUint16(2) & 0xf;
		if (rcode !== 0 && rcode !== 3) throw new Error("DNS error code " + rcode); // 3 = NXDOMAIN
		const questions = view.getUint16(4);
		const answers = view.getUint16(6);
		let offset = 12;
		for (let i = 0; i < questions; i++) offset = skipName(view, offset) + 4;

		const addresses = [];
		for (let i = 0; i < answers; i++) {
			offset = skipName(view, offset);
			const type = view.getUint16(offset);
			const length = view.getUint16(offset + 8);
			offset += 10;
			if (type === 1 && length === 4) {
				addresses.push(
					[0, 1, 2, 3].map((n) => view.getUint8(offset + n)).join(".")
				);
			}
			offset += length;
		}
		return addresses;
	}

	async function lookupBlocked(transport, hostname) {
		if (!transport.ready) await transport.init();
		const url = new URL(DOH_URL);
		url.searchParams.set("dns", encodeQuery(hostname));
		const res = await transport.request(
			url,
			"GET",
			null,
			[["accept", "application/dns-message"]],
			undefined
		);
		const body = await new Response(res.body).arrayBuffer();
		if (res.status !== 200) throw new Error("DoH status " + res.status);
		const addresses = parseAddresses(body);
		return addresses.length > 0 && addresses.every((ip) => ip === "0.0.0.0");
	}
/* filler: c__o__d__e */
	function isBlocked(transport, hostname) {
		hostname = hostname.toLowerCase().replace(/\.$/, "");
		const known = verdict(hostname);
		if (known !== undefined) return Promise.resolve(known);

		const now = Date.now();
		const cached = cache.get(hostname);
		if (cached && cached.expires > now) return cached.blocked;
		if (cache.size >= CACHE_LIMIT) {
			for (const [key, entry] of cache) {
				if (entry.expires <= now || cache.size >= CACHE_LIMIT) cache.delete(key);
				else break;
			}
		}

		const entry = { expires: now + CACHE_MS, blocked: null };
		// Fail open: if AdGuard can't be reached, browsing keeps working unfiltered.
		entry.blocked = lookupBlocked(transport, hostname).then(
			(blocked) => {
				entry.value = blocked;
				remember(hostname, blocked);
				return blocked;
			},
			(err) => {
				console.warn(`AdGuard DNS lookup for ${hostname} failed:`, err);
				entry.expires = Date.now() + ERROR_CACHE_MS;
				return false;
			}
		);
		cache.delete(hostname);
		cache.set(hostname, entry);
		return entry.blocked;
	}

	function blockedResponse(hostname) {
		const html = `<!doctype html><meta charset="utf-8"><title>Blocked</title>
<body style="font:16px system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px;color:#333">
<h1 style="font-size:22px">Blocked by AdGuard DNS</h1>
<p><b>${hostname}</b> is on AdGuard's list of ad and tracker domains, so Arc4dia didn't load it.</p></body>`;
		return {
			status: 403,
			statusText: "Blocked by AdGuard DNS",
			headers: [
				["content-type", "text/html; charset=utf-8"],
				["x-sj2-blocked", "adguard-dns"],
			],
			// An ArrayBuffer, since the controller transfers the body between threads.
			body: new TextEncoder().encode(html).buffer,
		};
	}
/* filler: c__o__d__e */
	// Wraps a Scramjet transport (libcurl or epoxy) so blocked hosts never connect.
	class FilteredTransport {
		constructor(inner) {
			this.inner = inner;
		}

		get ready() {
			return this.inner.ready;
		}

		init() {
			return this.inner.init();
		}

		async request(remote, method, body, headers, signal) {
			const host = remote.hostname;
			if (verdict(host) === undefined && body == null && (method === "GET" || method === "HEAD")) {
				// A host not seen before: ask AdGuard while the request is already on its way,
				// so pages don't wait for the lookup. If AdGuard blocks it, the answer is dropped.
				const controller = new AbortController();
				if (signal?.aborted) controller.abort(signal.reason);
				else signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
				const sent = this.inner.request(remote, method, body, headers, controller.signal);
				sent.catch(() => {}); // a failure is the caller's, below
				if (await isBlocked(this.inner, host)) {
					controller.abort();
					sent.then(discard, () => {});
					api.blockedCount++;
					return blockedResponse(host);
				}
				return sent;
			}
			if (await isBlocked(this.inner, host)) {
				api.blockedCount++;
				return blockedResponse(host);
			}
			return this.inner.request(remote, method, body, headers, signal);
		}
/* filler: c__o__d__e */
		connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
			let connection = null;
			let closed = null;
			isBlocked(this.inner, url.hostname).then((blocked) => {
				if (blocked) {
					api.blockedCount++;
					onerror(`${url.hostname} is blocked by AdGuard DNS`);
					return;
				}
				connection = this.inner.connect(
					url,
					protocols,
					requestHeaders,
					onopen,
					onmessage,
					onclose,
					onerror
				);
				if (closed) connection[1](...closed);
			});
			return [
				(data) => connection?.[0](data),
				(code, reason) => {
					if (connection) connection[1](code, reason);
					else closed = [code, reason];
				},
			];
		}
	}

	const api = {
		blockedCount: 0,
		wrap: (transport) => new FilteredTransport(transport),
		isBlocked,
		parseAddresses,
		encodeQuery,
	};
	return api;
})();
