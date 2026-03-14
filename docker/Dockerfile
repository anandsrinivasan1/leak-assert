# ── Stage 1: build the CLI ────────────────────────────────────────────────────
FROM rust:1.78-alpine AS builder

RUN apk add --no-cache musl-dev pkgconfig openssl-dev

WORKDIR /build
COPY Cargo.toml ./
COPY core/       ./core/
COPY cli/        ./cli/
COPY bindings/   ./bindings/

# Build only the CLI binary (static, minimal)
RUN cargo build --release -p leak-assert \
    --target x86_64-unknown-linux-musl 2>/dev/null \
    || cargo build --release -p leak-assert

# ── Stage 2: minimal runtime image ───────────────────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates

COPY --from=builder /build/target/release/leak-assert /usr/local/bin/leak-assert

# Default: run in watch mode against a sidecar URL
ENV LEAK_ASSERT_URL=http://app:9123/__leak_assert__/heap
ENV LEAK_ASSERT_INTERVAL=10
ENV LEAK_ASSERT_THRESHOLD=2kb/iter
ENV LEAK_ASSERT_WINDOW=20

ENTRYPOINT ["sh", "-c", \
  "leak-assert watch \
    --url \"$LEAK_ASSERT_URL\" \
    --interval \"$LEAK_ASSERT_INTERVAL\" \
    --threshold \"$LEAK_ASSERT_THRESHOLD\" \
    --window \"$LEAK_ASSERT_WINDOW\""]
