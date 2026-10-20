"use strict";
/* filler: c__o__d__e */
// Wisp server fallback. The site carries a list of Wisp servers (config.js), in order of
// preference; the first real Wisp server that answers is used. If that server stops
// responding later, the next one takes over without a reload.
self.WispPool = (() => {
	const PROBE_TIMEOUT = 6000;
	const HEALTH_TIMEOUT = 4000;

	// "host" or "host/path" or "wss://host/path" -> candidate URLs. A bare host is tried
	// at both /wisp/ (the usual path) and / since servers differ.
	function expand(entry) {
		entry = entry.trim();
		if (!entry) return [];
		if (entry === "self") {
			const local = new URL("wisp/", new URL("./", location.href));
			local.protocol = location.protocol === "https:" ? "wss:" : "ws:";
			return [local.href];
		}
		if (/^wss?:\/\//i.test(entry)) return [new URL(entry).href];
		const url = new URL("wss://" + entry);
		if (url.pathname !== "/") return [url.href];
		return [`wss://${url.host}/wisp/`, `wss://${url.host}/`];
	}

	function expandAll(entries) {
		return [...new Set(entries.flatMap(expand))];
	}

	// Resolves with `url` once it answers like a Wisp server: right after the socket opens
	// the server sends a CONTINUE (0x03, Wisp v1) or INFO (0x05, Wisp v2) packet.
	function probe(url, timeout = PROBE_TIMEOUT) {
		return new Promise((resolve, reject) => {
			let socket;
			const done = (ok, reason) => {
				clearTimeout(timer);
				try {
					socket.close();
				} catch {
					// already closed
				}
				ok ? resolve(url) : reject(new Error(`${url}: ${reason}`));
			};
			const timer = setTimeout(() => done(false, "timed out"), timeout);
			try {
				socket = new WebSocket(url);
			} catch (err) {
				return done(false, err.message);
			}
			socket.binaryType = "arraybuffer";
			socket.onmessage = ({ data }) => {
				const type = data instanceof ArrayBuffer && data.byteLength ? new Uint8Array(data)[0] : -1;
				done(type === 0x03 || type === 0x05, "not a Wisp server");
			};
			socket.onerror = () => done(false, "connection failed");
			socket.onclose = () => done(false, "closed");
		});
	}

	// The first of `urls` to answer wins. Throws if none do.
	async function fastest(urls) {
		if (!urls.length) throw new Error("No Wisp servers configured");
		try {
			return await Promise.any(urls.map((url) => probe(url)));
		} catch {
			throw new Error("None of the Wisp servers responded");
		}
	}
/* filler: c__o__d__e */
	// Every one of `urls` that answers, fastest first.
	async function healthy(urls) {
		const results = await Promise.allSettled(
			urls.map(async (url) => {
				const started = performance.now();
				await probe(url);
				return { url, time: performance.now() - started };
			})
		);
		return results
			.filter((r) => r.status === "fulfilled")
			.sort((a, b) => a.value.time - b.value.time)
			.map((r) => r.value.url);
	}

	function label(url) {
		try {
			const u = new URL(url);
			return u.host + (u.pathname === "/" ? "" : u.pathname.replace(/\/$/, ""));
		} catch {
			return url;
		}
	}

	const RESCUE_COOLDOWN = 60 * 1000;
	// Once one route answers with a blocked page, how long the others get to beat it.
	const RACE_GRACE = 2500;
	// Route marker: the site works on the main connection.
	const MAIN = "main";

	// Answers one server can get and another not: its IP is blocked or rate limited, or
	// the request failed on the way (the service worker turns that into a 500).
	const blocked = (status) => status === 403 || status === 429 || status >= 500;

	// Only requests without a body (page loads, images, scripts, API reads) are safe to
	// send more than once.
	const repeatable = (method, body) => body == null && (method === "GET" || method === "HEAD");

	function discard(response) {
		try {
			response?.body?.cancel?.()?.catch?.(() => {});
		} catch {
			// not a stream
		}
	}

	// Sends `run(transport, signal)` through every route at once. Resolves with the first
	// answer that isn't blocked (or, when every route is blocked, the first answer) and the
	// route it came through; the others are cancelled. Rejects if no route answers.
	function raceRoutes(routes, run, signal) {
		return new Promise((resolve, reject) => {
			const controllers = routes.map(() => new AbortController());
			const stop = () => controllers.forEach((c) => c.abort(signal?.reason));
			if (signal?.aborted) stop();
			else signal?.addEventListener("abort", stop, { once: true });
			let done = false;
			let settled = 0;
			let fallback = null;
			let firstError = null;
			let grace = null;
			const finish = (winner) => {
				done = true;
				clearTimeout(grace);
				controllers.forEach((c, i) => i !== winner.index && c.abort());
				resolve(winner);
			};
			routes.forEach((transport, index) => {
				(async () => {
					if (!transport.ready) await transport.init();
					return run(transport, controllers[index].signal);
				})()
					.then(
						(response) => {
							if (done) return discard(response);
							const entry = { transport, response, index };
							if (!blocked(response.status)) {
								discard(fallback?.response);
								return finish(entry);
							}
							if (fallback) return discard(response);
							fallback = entry;
							grace = setTimeout(() => finish(fallback), RACE_GRACE);
						},
						(err) => {
							firstError ??= err;
						}
					)
					.finally(() => {
						if (++settled < routes.length || done) return;
						if (fallback) return finish(fallback);
						done = true;
						reject(firstError);
					});
			});
		});
	}

	// Sits in front of the real transport and swaps it out when its Wisp server dies.
	// `connectTo(url)` builds a fresh transport for a server URL; `pick(exclude)` returns
	// the URL to switch to.
	//
	// It also picks a route per site. The first request to a site goes out through the
	// main connection and all of `alternatives()` (other TLS engines / servers) at once,
	// and whichever answers first is used for the rest of that site. If a site later fails
	// or answers with a blocked page, the other routes are tried again.
	class FailoverTransport {
		constructor({ url, transport, connectTo, pick, onSwitch, alternatives }) {
			this.url = url;
			this.inner = transport;
			this.connectTo = connectTo;
			this.pick = pick;
			this.onSwitch = onSwitch;
			this.alternatives = alternatives || (() => []);
			this.dead = new Set();
			this.checking = null;
			this.routes = new Map(); // hostname -> MAIN or the transport that works for it
			this.deciding = new Map(); // hostname -> race still picking its route
			this.hopeless = new Map(); // hostname -> time rescue may be tried again
			this.retried = new Map(); // hostname -> time a blocked answer may be retried again
		}

		// The transport a site's requests go through.
		routeFor(host) {
			const route = this.routes.get(host);
			return route && route !== MAIN ? route : this.inner;
		}

		remember(host, transport) {
			this.routes.set(host, transport === this.inner ? MAIN : transport);
		}

		async otherRoutes(...skip) {
			let alternatives = [];
			try {
				alternatives = await this.alternatives();
			} catch (err) {
				console.warn("No backup routes:", err);
			}
			return [...new Set([this.inner, ...alternatives])].filter((t) => !skip.includes(t));
		}

		// First request to a site: every route at once, the first to answer wins.
		async decide(host, send, signal) {
			const race = this.otherRoutes().then((routes) => raceRoutes(routes, send, signal));
			this.deciding.set(host, race);
			try {
				const { transport, response } = await race;
				this.remember(host, transport);
				return response;
			} catch (err) {
				if (signal?.aborted) throw err;
				// Nothing got through: if the main server died, the next one may.
				if (await this.checkServer()) return send(this.inner);
				this.hopeless.set(host, Date.now() + RESCUE_COOLDOWN);
				throw err;
			} finally {
				this.deciding.delete(host);
			}
		}

		// The site answered with a blocked page: ask the other routes once (per cooldown) and
		// switch the site over if one gets a real answer.
		async retryBlocked(host, used, response, send, signal) {
			if (this.retried.get(host) > Date.now()) return response;
			this.retried.set(host, Date.now() + RESCUE_COOLDOWN);
			const others = await this.otherRoutes(used);
			if (!others.length) return response;
			try {
				const winner = await raceRoutes(others, send, signal);
				if (blocked(winner.response.status)) {
					discard(winner.response);
					return response;
				}
				discard(response);
				this.remember(host, winner.transport);
				return winner.response;
			} catch {
				return response;
			}
		}

		// Tries `run(transport)` on each alternative; remembers the first that works.
		async rescue(host, run) {
			if (this.hopeless.get(host) > Date.now()) return null;
			for (const alt of await this.alternatives()) {
				if (alt === this.inner) continue;
				try {
					if (!alt.ready) await alt.init();
					const result = await run(alt);
					this.remember(host, alt);
					return { result };
				} catch {
					// try the next one
				}
			}
			this.hopeless.set(host, Date.now() + RESCUE_COOLDOWN);
			return null;
		}
/* filler: c__o__d__e */
		get ready() {
			return this.inner.ready;
		}

		init() {
			return this.inner.init();
		}

		use(url, transport) {
			this.url = url;
			this.inner = transport;
		}

		// After a failed request: if the current server no longer answers, move to another.
		// Resolves true when the transport was replaced.
		checkServer() {
			this.checking ??= (async () => {
				const url = this.url;
				try {
					await probe(url, HEALTH_TIMEOUT);
					return false; // server is fine; the site itself failed
				} catch {
					this.dead.add(url);
				}
				const next = await this.pick(this.dead);
				if (!next || next === url) return false;
				this.use(next, await this.connectTo(next));
				this.onSwitch?.(url, next);
				return true;
			})()
				.catch((err) => {
					console.warn("Wisp failover failed:", err);
					return false;
				})
				.finally(() => {
					this.checking = null;
				});
			return this.checking;
		}

		async request(remote, method, body, headers, signal) {
			const host = remote.hostname;
			const send = (transport, sig = signal) => transport.request(remote, method, body, headers, sig);
			const raceable = repeatable(method, body);
			if (raceable && !this.routes.has(host) && !(this.hopeless.get(host) > Date.now())) {
				const pending = this.deciding.get(host);
				// Requests made while the site's first race runs wait for its winner.
				if (pending) await pending.catch(() => {});
				else return this.decide(host, send, signal);
			}
			const first = this.routeFor(host);
			let response;
			try {
				response = await send(first);
			} catch (err) {
				if (signal?.aborted) throw err;
				// Only bodiless requests (page loads, images, scripts) are safe to send again.
				if (body != null) throw err;
				if (first !== this.inner) {
					this.routes.delete(host);
				} else if (await this.checkServer()) {
					try {
						return await send(this.inner);
					} catch {
						// fall through to the site rescue
					}
				}
				const rescued = await this.rescue(host, send);
				if (rescued) return rescued.result;
				throw err;
			}
			if (raceable && blocked(response.status)) return this.retryBlocked(host, first, response, send, signal);
			return response;
		}
/* filler: c__o__d__e */
		// WebSockets: use the site's known route; if it fails before opening, try the
		// alternatives before reporting the error.
		connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
			const host = url.hostname;
			let current = null;
			let closed = null;
			let opened = false;

			const attempt = (transport, next) => {
				current = transport.connect(
					url,
					protocols,
					requestHeaders,
					(...args) => {
						opened = true;
						if (transport !== this.inner) this.routes.set(host, transport);
						onopen(...args);
					},
					onmessage,
					onclose,
					(error) => {
						if (opened || closed) return onerror(error);
						if (transport === this.inner) this.checkServer();
						else if (this.routes.get(host) === transport) this.routes.delete(host);
						next ? next(error) : onerror(error);
					}
				);
				if (closed) current[1](...closed);
			};

			const tryAlternatives = async (error) => {
				if (this.hopeless.get(host) > Date.now()) return onerror(error);
				const list = (await this.alternatives()).filter((t) => t !== this.inner);
				const step = (i) => async (lastError) => {
					if (i >= list.length || closed) {
						if (!closed) this.hopeless.set(host, Date.now() + RESCUE_COOLDOWN);
						return onerror(lastError);
					}
					try {
						if (!list[i].ready) await list[i].init();
						attempt(list[i], step(i + 1));
					} catch {
						step(i + 1)(lastError);
					}
				};
				step(0)(error);
			};

			attempt(this.routeFor(host), tryAlternatives);
			return [
				(data) => current?.[0](data),
				(code, reason) => {
					closed = [code, reason];
					current?.[1](code, reason);
				},
			];
		}
	}

	return { expand, expandAll, probe, fastest, healthy, label, FailoverTransport };
})();
