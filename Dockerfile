FROM node:22-slim AS base

WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git openssh-client procps python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
COPY packages/harness/package.json packages/harness/package.json
COPY packages/mcp/package.json packages/mcp/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm rebuild --pending
RUN cd "$(dirname "$(find node_modules/.pnpm -path '*/node_modules/better-sqlite3/package.json' -print -quit)")" \
  && npm_config_ignore_scripts=false npm run build-release

COPY . .

FROM base AS dev
ENV DUCTUM_HOST=0.0.0.0
ENV DUCTUM_DASHBOARD_HOST=0.0.0.0
ENV DUCTUM_DB_PATH=/data/ductum.db
EXPOSE 4100 5176
CMD ["pnpm", "docker:dev"]

FROM base AS build
RUN pnpm build

FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV DUCTUM_HOST=0.0.0.0
ENV DUCTUM_DB_PATH=/data/ductum.db
ENV DUCTUM_DASHBOARD_DIST=packages/dashboard/dist

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git openssh-client procps \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/README.md /app/CLAUDE.md /app/AGENTS.md ./
COPY --from=build /app/.edictum ./.edictum
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/workflows ./workflows

EXPOSE 4100
CMD ["node", "scripts/serve.mjs", "--host", "0.0.0.0", "--no-dashboard"]
