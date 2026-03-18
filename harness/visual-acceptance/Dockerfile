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

RUN curl -fsSL https://get.docker.com | sh

RUN curl -fsSL https://bun.sh/install | bash \
  && ln -sf /root/.bun/bin/bun /usr/local/bin/bun \
  && ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx

WORKDIR /workspace

COPY harness/visual-acceptance/entrypoint.sh /usr/local/bin/visual-acceptance-entrypoint

ENTRYPOINT ["/usr/local/bin/visual-acceptance-entrypoint"]
