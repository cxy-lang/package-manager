# ---- Builder stage ----
FROM suilteam/cxy:latest-alpine AS builder

# Install build dependencies
RUN apk add --no-cache openssl-dev sqlite-dev

# Copy source and build
COPY . /cxy
WORKDIR /cxy

RUN cxy package install --verbose && cxy package run release

# ---- Runtime stage ----
FROM alpine:latest

# Build arguments
ARG RELEASE_TAG=v0.1.0

# Set environment variables
ENV RELEASE_TAG=${RELEASE_TAG}

# Set labels
LABEL version="${RELEASE_TAG}"

# Install runtime dependencies
RUN apk add --no-cache openssl sqlite-libs

# Copy the release artifacts
COPY --from=builder /cxy/.cxy/build/release /package-manager

# Data directory for persistent storage (database, caches)
VOLUME ["/data"]

WORKDIR /package-manager

# Default environment variables (override at runtime)
ENV PORT=8080
ENV DB_PATH=/data/registry.db
ENV STATIC_DIR=/package-manager/static
ENV REGISTRY_URL=http://localhost:8080
ENV MARKDOWN_CACHE_DIR=/data/.markdown-cache
# JWT_SECRET must be provided at runtime - no default for security
# ADMIN_PASSWORD is optional - a random one will be generated if not set
# GitHub OAuth (all three required together if enabling OAuth):
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=
# GITHUB_CALLBACK_URL=

EXPOSE 8080

ENTRYPOINT ["/package-manager/package-manager"]
