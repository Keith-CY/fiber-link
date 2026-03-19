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

RUN install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
  && chmod a+r /etc/apt/keyrings/docker.asc \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends docker-buildx-plugin docker-ce-cli docker-compose-plugin \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash \
  && ln -sf /root/.bun/bin/bun /usr/local/bin/bun \
  && ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx

RUN npx --yes --package @playwright/cli playwright install chromium

WORKDIR /workspace

COPY harness/visual-acceptance/entrypoint.sh /usr/local/bin/visual-acceptance-entrypoint

ENTRYPOINT ["/usr/local/bin/visual-acceptance-entrypoint"]
