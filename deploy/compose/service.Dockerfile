FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS base

# Install bun under /opt (not /root/.bun) so the runtime stages can drop to the
# non-root `node` user (uid/gid 1000, built into the node base image) and still
# traverse into the install directory to execute it.
ENV BUN_INSTALL=/opt/bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://bun.sh/install | bash -s -- bun-v1.3.11 \
  && ln -sf /opt/bun/bin/bun /usr/local/bin/bun \
  && ln -sf /opt/bun/bin/bunx /usr/local/bin/bunx

COPY fiber-link-service/package.json ./package.json
COPY fiber-link-service/bun.lockb ./bun.lockb
COPY fiber-link-service/tsconfig.base.json ./tsconfig.base.json
COPY fiber-link-service/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY fiber-link-service/apps ./apps
COPY fiber-link-service/packages ./packages

RUN bun install --frozen-lockfile

FROM base AS migrate
USER node
WORKDIR /app/packages/db
CMD ["bun", "run", "drizzle-kit", "migrate", "--config=drizzle.config.ts"]

FROM base AS rpc
USER node
EXPOSE 3000
CMD ["bun", "run", "apps/rpc/src/entry.ts"]

FROM base AS worker
# Pre-create the legacy cursor volume mount point owned by `node` so a fresh
# `worker-data` named volume inherits node-writable ownership. Volumes created
# by an older (root-running) image stay root-owned; see the compose runbook for
# the one-time chown when upgrading.
RUN mkdir -p /var/lib/fiber-link && chown node:node /var/lib/fiber-link
USER node
CMD ["bun", "run", "apps/worker/src/entry.ts"]
