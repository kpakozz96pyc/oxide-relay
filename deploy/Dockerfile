FROM node:22-bookworm AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM rust:1.91-bookworm AS backend-builder

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
COPY --from=backend-builder /app/target/release/oxiderelay-backend /usr/local/bin/oxiderelay
COPY --from=frontend-builder /app/frontend/dist /app/frontend-dist

ENV OXIDERELAY_HOST=0.0.0.0
ENV OXIDERELAY_PORT=8080
ENV OXIDERELAY_DATABASE_PATH=/data/oxiderelay.sqlite
ENV OXIDERELAY_FRONTEND_DIST_PATH=/app/frontend-dist

EXPOSE 8080

CMD ["oxiderelay"]
