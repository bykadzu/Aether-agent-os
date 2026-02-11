# =============================================================================
# Aether OS Kernel — Production Dockerfile
# Multi-stage build: install deps + runtime with tsx (ESM monorepo)
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Install dependencies and prepare the application
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

# Native build tools for better-sqlite3 and node-pty
RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json* ./

# Copy sub-package manifests (needed for file: references in npm install)
COPY kernel/package.json kernel/package.json
COPY runtime/package.json runtime/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
COPY sdk/package.json sdk/package.json

# Install all dependencies (monorepo — everything shares root node_modules)
RUN npm ci --include=dev

# Copy source code for kernel packages
COPY kernel/ kernel/
COPY runtime/ runtime/
COPY server/ server/
COPY shared/ shared/
COPY sdk/ sdk/

# ---------------------------------------------------------------------------
# Stage 2: Production runtime
# ---------------------------------------------------------------------------
FROM node:22-slim

# Runtime dependencies for native modules and Docker CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy everything from builder
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/kernel /app/kernel
COPY --from=builder /app/runtime /app/runtime
COPY --from=builder /app/server /app/server
COPY --from=builder /app/shared /app/shared
COPY --from=builder /app/sdk /app/sdk

# Create aether data directory
RUN mkdir -p /root/.aether

ENV NODE_ENV=production
ENV AETHER_FS_ROOT=/root/.aether

EXPOSE 3001

# Run with tsx since the monorepo uses ESM and file: references pointing to .ts sources
CMD ["npx", "tsx", "server/src/index.ts"]
