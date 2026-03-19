FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS base

ENV BUN_INSTALL=/root/.bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://bun.sh/install | bash -s -- bun-v1.2.19 \
  && ln -sf /root/.bun/bin/bun /usr/local/bin/bun \
  && ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx

COPY fiber-link-service/package.json ./package.json
COPY fiber-link-service/bun.lockb ./bun.lockb
COPY fiber-link-service/tsconfig.base.json ./tsconfig.base.json
COPY fiber-link-service/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY fiber-link-service/apps ./apps
COPY fiber-link-service/packages ./packages

RUN bun install --frozen-lockfile

FROM base AS rpc
EXPOSE 3000
CMD ["bun", "run", "apps/rpc/src/entry.ts"]

FROM base AS worker
CMD ["bun", "run", "apps/worker/src/entry.ts"]
