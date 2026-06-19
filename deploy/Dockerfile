FROM rust:1.91-bookworm AS builder

WORKDIR /app
COPY Cargo.lock Cargo.lock
COPY Cargo.toml Cargo.toml
COPY backend/Cargo.toml backend/Cargo.toml
COPY migrations migrations
COPY backend/src backend/src

RUN cargo build --release -p oxiderelay-backend

FROM debian:bookworm-slim

WORKDIR /app
RUN mkdir -p /data
COPY --from=builder /app/target/release/oxiderelay-backend /usr/local/bin/oxiderelay

ENV OXIDERELAY_HOST=0.0.0.0
ENV OXIDERELAY_PORT=8080
ENV OXIDERELAY_DATABASE_PATH=/data/oxiderelay.sqlite

EXPOSE 8080

CMD ["oxiderelay"]
