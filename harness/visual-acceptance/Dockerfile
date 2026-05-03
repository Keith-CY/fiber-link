FROM mcr.microsoft.com/playwright:v1.52.0-noble

USER root

RUN find /etc/apt -type f \( -name '*.list' -o -name '*.sources' \) -print0 \
    | xargs -0 -r sed -i \
      -e 's|http://archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' \
      -e 's|http://security.ubuntu.com/ubuntu|https://security.ubuntu.com/ubuntu|g' \
  && apt-get update -o Acquire::Retries=5 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 \
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
