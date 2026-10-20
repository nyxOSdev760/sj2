# Skeld with the Rust server (server/). Render: runtime "docker" (see render.yaml).

# 1. The proxy builds from npm (transports, and Scramjet, which postinstall turns into servy2).
FROM node:22-bookworm-slim AS site
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund

# 2. The server. Dependencies are built first so code changes don't rebuild them.
FROM rust:1-slim-bookworm AS server
WORKDIR /app/server
COPY server/Cargo.toml server/Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release --locked && rm -rf src
COPY server/src ./src
RUN touch src/main.rs && cargo build --release --locked

# 3. What runs: the server binary, public/ and the proxy builds it serves.
FROM debian:bookworm-slim
WORKDIR /app
COPY --from=site /app/servy2/dist servy2/dist
COPY --from=site /app/node_modules/@mercuryworkshop/libcurl-transport/dist node_modules/@mercuryworkshop/libcurl-transport/dist
COPY --from=site /app/node_modules/@mercuryworkshop/epoxy-transport/dist node_modules/@mercuryworkshop/epoxy-transport/dist
COPY public ./public
COPY --from=server /app/server/target/release/skeld-server /usr/local/bin/skeld-server
ENV SKELD_ROOT=/app PORT=8080
EXPOSE 8080
USER nobody
CMD ["skeld-server"]
