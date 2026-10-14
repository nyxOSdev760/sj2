"use strict";

// Ad and tracker blocking through AdGuard DNS (94.140.14.14 / 94.140.15.15).
//
// AdGuard DNS answers 0.0.0.0 for ad and tracker domains. Before the proxy opens a
// request or WebSocket, the hostname is looked up over DNS-over-HTTPS (sent through the
// proxy's own transport, so it works on static hosts with any Wisp server), and the
// connection is refused when AdGuard blocks it. Answers are cached per hostname.
// The Node server additionally resolves every Wisp connection through AdGuard (src/index.js).
self.AdGuardDNS = (() => {
	// dns.adguard-dns.com is AdGuard's DoH endpoint on 94.140.14.14 and 94.140.15.15.
	const DOH_URL = "https://dns.adguard-dns.com/dns-query";
	const DOH_HOST = new URL(DOH_URL).hostname;
	const CACHE_MS = 10 * 60 * 1000;
	const ERROR_CACHE_MS = 30 * 1000;
	const CACHE_LIMIT = 5000;

	const cache = new Map(); // hostname -> { expires, blocked: Promise<boolean> }

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

	function isBlocked(transport, hostname) {
		hostname = hostname.toLowerCase().replace(/\.$/, "");
		if (!api.enabled || !hostname || hostname === DOH_HOST || isIpLiteral(hostname)) {
			return Promise.resolve(false);
		}

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
		entry.blocked = lookupBlocked(transport, hostname).catch((err) => {
			console.warn(`AdGuard DNS lookup for ${hostname} failed:`, err);
			entry.expires = Date.now() + ERROR_CACHE_MS;
			return false;
		});
		cache.delete(hostname);
		cache.set(hostname, entry);
		return entry.blocked;
	}

	function blockedResponse(hostname) {
		const html = `<!doctype html><meta charset="utf-8"><title>Blocked</title>
<body style="font:16px system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px;color:#333">
<h1 style="font-size:22px">Blocked by AdGuard DNS</h1>
<p><b>${hostname}</b> is on AdGuard's list of ad and tracker domains, so Saints didn't load it.
You can turn blocking off in Settings.</p></body>`;
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
			if (await isBlocked(this.inner, remote.hostname)) {
				api.blockedCount++;
				return blockedResponse(remote.hostname);
			}
			return this.inner.request(remote, method, body, headers, signal);
		}

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
		enabled: true,
		blockedCount: 0,
		wrap: (transport) => new FilteredTransport(transport),
		isBlocked,
		parseAddresses,
		encodeQuery,
	};
	return api;
})();
