// Arc4dia's server, in Rust: serves the site and runs the Wisp endpoint (/wisp/) that
// proxied pages tunnel their TCP connections through. It does what src/index.js does:
//
// * static files from the same mounts as src/mounts.js (public/ plus the proxy builds in
//   node_modules), with public/404.html for anything missing;
// * hostnames are resolved with AdGuard DNS (DNS_SERVERS, default 94.140.14.14 and
//   94.140.15.15), which answers 0.0.0.0 for ad and tracker domains, so those connections
//   are refused;
// * connections to private, loopback and other non-public addresses are refused, so the
//   proxy can't reach the host's own network.
//
// Settings (environment): PORT (8080), HOST (0.0.0.0), DNS_SERVERS ("" = system
// resolver), SKELD_ROOT (the repo folder; defaults to the current directory).

use std::convert::Infallible;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use fastwebsockets::{upgrade, FragmentCollectorRead};
use hickory_resolver::config::{LookupIpStrategy, NameServerConfig, ResolverConfig};
use hickory_resolver::net::runtime::TokioRuntimeProvider;
use hickory_resolver::TokioResolver;
use http_body_util::{combinators::BoxBody, BodyExt, Empty, Full};
use hyper::body::Incoming;
use hyper::header::{HeaderValue, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use wisp_mux::{CloseReason, ConnectPacket, MuxStream, ServerMux, StreamType};

type Body = BoxBody<Bytes, Infallible>;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
// Wisp flow control: how many packets a client may send on a stream before waiting.
const WISP_BUFFER: u32 = 128;

struct App {
	// URL prefix -> folder. First match wins, so "/" is last.
	mounts: Vec<(&'static str, PathBuf)>,
	resolver: TokioResolver,
}

#[tokio::main]
async fn main() {
	let root = std::env::var("SKELD_ROOT")
		.map(PathBuf::from)
		.unwrap_or_else(|_| std::env::current_dir().expect("current directory"));
	let modules = root.join("node_modules").join("@mercuryworkshop");
	let mounts = vec![
		("/scramjet/", modules.join("scramjet").join("dist")),
		("/controller/", modules.join("scramjet-controller").join("dist")),
		("/libcurl/", modules.join("libcurl-transport").join("dist")),
		("/epoxy/", modules.join("epoxy-transport").join("dist")),
		("/", root.join("public")),
	];
	let mounts = mounts
		.into_iter()
		.map(|(prefix, dir)| {
			let dir = dir.canonicalize().unwrap_or_else(|_| panic!("missing folder {}", dir.display()));
			(prefix, dir)
		})
		.collect();

	let dns: Vec<IpAddr> = std::env::var("DNS_SERVERS")
		.unwrap_or_else(|_| "94.140.14.14,94.140.15.15".into())
		.split(',')
		.filter_map(|s| s.trim().parse().ok())
		.collect();
	let mut builder = if dns.is_empty() {
		TokioResolver::builder_tokio().expect("system DNS configuration")
	} else {
		let servers = dns.iter().map(|ip| NameServerConfig::udp_and_tcp(*ip)).collect();
		TokioResolver::builder_with_config(ResolverConfig::from_name_servers(servers), TokioRuntimeProvider::default())
	};
	builder.options_mut().ip_strategy = LookupIpStrategy::Ipv4thenIpv6;
	let resolver = builder.build().expect("DNS resolver");

	let app = Arc::new(App { mounts, resolver });
	let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080);
	let host: IpAddr = std::env::var("HOST").ok().and_then(|h| h.parse().ok()).unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
	let listener = TcpListener::bind(SocketAddr::new(host, port)).await.expect("bind");
	println!("Arc4dia listening on http://localhost:{port}");
	if dns.is_empty() {
		println!("DNS: system resolver");
	} else {
		let list: Vec<String> = dns.iter().map(|ip| ip.to_string()).collect();
		println!("DNS: {}", list.join(", "));
	}

	let serve = async {
		loop {
			let (socket, _) = match listener.accept().await {
				Ok(conn) => conn,
				Err(err) => {
					eprintln!("accept failed: {err}");
					continue;
				}
			};
			let _ = socket.set_nodelay(true);
			let app = app.clone();
			tokio::spawn(async move {
				let service = service_fn(move |req| handle(app.clone(), req));
				let conn = http1::Builder::new().serve_connection(TokioIo::new(socket), service).with_upgrades();
				let _ = conn.await;
			});
		}
	};
	tokio::select! {
		_ = serve => {}
		_ = shutdown_signal() => println!("Shutting down"),
	}
}

async fn shutdown_signal() {
	let ctrl_c = tokio::signal::ctrl_c();
	#[cfg(unix)]
	{
		let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("signal handler");
		tokio::select! {
			_ = ctrl_c => {}
			_ = term.recv() => {}
		}
	}
	#[cfg(not(unix))]
	let _ = ctrl_c.await;
}

async fn handle(app: Arc<App>, mut req: Request<Incoming>) -> Result<Response<Body>, Infallible> {
	let path = req.uri().path();
	if path == "/wisp" || path.starts_with("/wisp/") {
		if !upgrade::is_upgrade_request(&req) {
			return Ok(text(StatusCode::BAD_REQUEST, "Wisp needs a WebSocket"));
		}
		let (response, fut) = match upgrade::upgrade(&mut req) {
			Ok(pair) => pair,
			Err(_) => return Ok(text(StatusCode::BAD_REQUEST, "Bad WebSocket request")),
		};
		tokio::spawn(async move {
			if let Err(err) = wisp(app, fut).await {
				eprintln!("wisp connection ended: {err}");
			}
		});
		return Ok(response.map(|body| body.map_err(|never| match never {}).boxed()));
	}
	Ok(static_file(&app, &req).await)
}

// ---- Static files ----

fn text(status: StatusCode, body: &'static str) -> Response<Body> {
	let mut res = Response::new(Full::new(Bytes::from_static(body.as_bytes())).boxed());
	*res.status_mut() = status;
	res.headers_mut().insert(CONTENT_TYPE, HeaderValue::from_static("text/plain; charset=utf-8"));
	res
}

fn mime(path: &Path) -> &'static str {
	match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
		Some("html") => "text/html; charset=utf-8",
		Some("js" | "mjs") => "text/javascript; charset=utf-8",
		Some("css") => "text/css; charset=utf-8",
		Some("json" | "map") => "application/json; charset=utf-8",
		Some("wasm") => "application/wasm",
		Some("woff2") => "font/woff2",
		Some("svg") => "image/svg+xml",
		Some("png") => "image/png",
		Some("jpg" | "jpeg") => "image/jpeg",
		Some("ico") => "image/x-icon",
		Some("txt") => "text/plain; charset=utf-8",
		_ => "application/octet-stream",
	}
}

// Maps a URL path to a file inside one of the mounts, or None. "..", absolute parts and
// symlinks out of the mount are refused.
fn resolve(app: &App, path: &str) -> Option<PathBuf> {
	let (prefix, dir) = app.mounts.iter().find(|(prefix, _)| path.starts_with(prefix))?;
	let rest = &path[prefix.len()..];
	let mut file = dir.clone();
	for part in Path::new(rest).components() {
		match part {
			Component::Normal(name) => file.push(name),
			Component::CurDir => {}
			_ => return None,
		}
	}
	if file.is_dir() {
		file.push("index.html");
	}
	let file = file.canonicalize().ok()?;
	(file.starts_with(dir) && file.is_file()).then_some(file)
}

async fn static_file(app: &App, req: &Request<Incoming>) -> Response<Body> {
	if req.method() != Method::GET && req.method() != Method::HEAD {
		return text(StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed");
	}
	let Ok(path) = percent_encoding::percent_decode_str(req.uri().path()).decode_utf8() else {
		return text(StatusCode::BAD_REQUEST, "Bad Request");
	};
	let (status, file) = match resolve(app, &path) {
		Some(file) => (StatusCode::OK, Some(file)),
		None => (StatusCode::NOT_FOUND, resolve(app, "/404.html")),
	};
	let data = match &file {
		Some(file) => tokio::fs::read(file).await.ok(),
		None => None,
	};
	let mut res = Response::new(match (&data, req.method() == Method::HEAD) {
		(Some(data), false) => Full::new(Bytes::from(data.clone())).boxed(),
		_ => Empty::new().map_err(|never| match never {}).boxed(),
	});
	*res.status_mut() = status;
	let headers = res.headers_mut();
	if let (Some(file), Some(data)) = (&file, &data) {
		headers.insert(CONTENT_TYPE, HeaderValue::from_static(mime(file)));
		if status == StatusCode::OK {
			headers.insert(CONTENT_LENGTH, HeaderValue::from(data.len()));
			headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
			headers.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
		}
	}
	res
}

// ---- Wisp ----

async fn wisp(app: Arc<App>, fut: upgrade::UpgradeFut) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
	let ws = fut.await?;
	let (rx, tx) = ws.split(tokio::io::split);
	let rx = FragmentCollectorRead::new(rx);
	// Wisp v1 (no extensions): the version every client speaks.
	let (mux, driver) = ServerMux::create(rx, tx, WISP_BUFFER, None).await?.with_no_required_extensions();
	let driver = tokio::spawn(driver);
	while let Some((packet, stream)) = mux.server_new_stream().await {
		let app = app.clone();
		tokio::spawn(async move {
			match connect(&app, &packet).await {
				Ok(tcp) => relay(tcp, stream).await,
				// Keep the stream until the reason is sent; dropping it first would close it
				// as "unknown".
				Err(reason) => {
					let _ = stream.close(reason).await;
				}
			}
		});
	}
	let _ = driver.await;
	Ok(())
}

// Opens the TCP connection a Wisp stream asks for, or says why it can't.
async fn connect(app: &App, packet: &ConnectPacket) -> Result<TcpStream, CloseReason> {
	if packet.stream_type != StreamType::Tcp {
		return Err(CloseReason::ServerStreamInvalidInfo); // UDP isn't offered
	}
	let ip = lookup(app, &packet.destination_hostname).await?;
	if !is_public(ip) {
		return Err(CloseReason::ServerStreamBlockedAddress);
	}
	let tcp = match tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect((ip, packet.destination_port))).await {
		Err(_) => return Err(CloseReason::ServerStreamConnectionTimedOut),
		Ok(Err(err)) if err.kind() == std::io::ErrorKind::ConnectionRefused => {
			return Err(CloseReason::ServerStreamConnectionRefused)
		}
		Ok(Err(_)) => return Err(CloseReason::ServerStreamUnreachable),
		Ok(Ok(tcp)) => tcp,
	};
	let _ = tcp.set_nodelay(true);
	Ok(tcp)
}

// Copies data both ways until either side closes.
async fn relay(tcp: TcpStream, stream: MuxStream) {
	let closer = stream.get_close_handle();
	let (mut tcp_read, mut tcp_write) = tcp.into_split();
	let (wisp_read, wisp_write) = stream.into_split();

	let upload = async {
		while let Some(data) = wisp_read.read().await {
			if tcp_write.write_all(&data).await.is_err() {
				break;
			}
		}
		let _ = tcp_write.shutdown().await;
	};
	let download = async {
		let mut buf = vec![0u8; 64 * 1024];
		loop {
			match tcp_read.read(&mut buf).await {
				Ok(0) | Err(_) => break,
				Ok(n) => {
					if wisp_write.write(&buf[..n]).await.is_err() {
						break;
					}
				}
			}
		}
	};
	// The site closing its side ends the stream; the client closing ends it too.
	tokio::select! {
		_ = upload => {}
		_ = download => {}
	}
	let _ = closer.close(CloseReason::Voluntary).await;
}

async fn lookup(app: &App, host: &str) -> Result<IpAddr, CloseReason> {
	let host = host.trim_start_matches('[').trim_end_matches(']');
	if let Ok(ip) = host.parse::<IpAddr>() {
		return Ok(ip);
	}
	let found = app.resolver.lookup_ip(host).await.map_err(|_| CloseReason::ServerStreamUnreachable)?;
	found.iter().next().ok_or(CloseReason::ServerStreamUnreachable)
}

// Public internet addresses only. AdGuard's 0.0.0.0 answer for blocked domains lands
// here as "unspecified".
fn is_public(ip: IpAddr) -> bool {
	match ip {
		IpAddr::V4(v4) => is_public_v4(v4),
		IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
			Some(v4) => is_public_v4(v4),
			None => is_public_v6(v6),
		},
	}
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
	let [a, b, ..] = ip.octets();
	!(ip.is_unspecified()
		|| ip.is_loopback()
		|| ip.is_private()
		|| ip.is_link_local()
		|| ip.is_broadcast()
		|| ip.is_multicast()
		|| ip.is_documentation()
		|| a == 0 // "this network"
		|| (a == 100 && (64..128).contains(&b)) // carrier-grade NAT
		|| (a == 192 && b == 0 && ip.octets()[2] == 0) // IETF protocol assignments
		|| (a == 198 && (b == 18 || b == 19)) // benchmarking
		|| a >= 240) // reserved
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
	let first = ip.segments()[0];
	!(ip.is_unspecified()
		|| ip.is_loopback()
		|| ip.is_multicast()
		|| (first & 0xfe00) == 0xfc00 // unique local
		|| (first & 0xffc0) == 0xfe80 // link-local
		|| first == 0x2001 && ip.segments()[1] == 0x0db8 // documentation
		|| first == 0x0064 && ip.segments()[1] == 0xff9b) // NAT64 can reach private IPv4
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn blocks_non_public_addresses() {
		for ip in [
			"0.0.0.0", "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1",
			"224.0.0.1", "255.255.255.255", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
			"64:ff9b::a00:1",
		] {
			assert!(!is_public(ip.parse().unwrap()), "{ip} should be blocked");
		}
		for ip in ["1.1.1.1", "142.250.80.46", "2606:4700:4700::1111"] {
			assert!(is_public(ip.parse().unwrap()), "{ip} should be allowed");
		}
	}
}
