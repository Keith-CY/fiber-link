FROM mcr.microsoft.com/playwright:v1.52.0-noble

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    expect \
    git \
    jq \
    openssl \
    rsync \
    unzip \
  && rm -rf /var/lib/apt/lists/*

# Warm the third-party playwright-cli package together with its own Playwright dependency,
# so the matching Chromium bundle is baked into the sidecar image for deterministic CI runs.
RUN npx --yes --package @playwright/cli playwright install chromium
