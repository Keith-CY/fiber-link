FROM oven/bun:1.1.8

WORKDIR /app

COPY fiber-link-service/package.json ./package.json
COPY fiber-link-service/bun.lockb ./bun.lockb
COPY fiber-link-service/tsconfig.base.json ./tsconfig.base.json
COPY fiber-link-service/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY fiber-link-service/apps ./apps
COPY fiber-link-service/packages ./packages

RUN bun install --frozen-lockfile

CMD ["bun", "run", "apps/worker/src/entry.ts"]
