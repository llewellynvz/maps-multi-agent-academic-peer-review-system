# syntax=docker/dockerfile:1

FROM node:22-bookworm AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate
WORKDIR /build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mara/app build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    MARA_ROOT_DIR=/app \
    PORT=3100 \
    HOSTNAME=0.0.0.0
WORKDIR /app

COPY --from=build /build/node_modules /app/node_modules
COPY --from=build /build/server /app/server
COPY --from=build /build/packages /app/packages
COPY --from=build /build/knowledge /app/knowledge
COPY --from=build /build/agents /app/agents
COPY --from=build /build/package.json /app/package.json
COPY --from=build /build/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=build /build/tsconfig.base.json /app/tsconfig.base.json

COPY --from=build /build/app/.next/standalone /app/web
COPY --from=build /build/app/.next/static /app/web/app/.next/static
COPY --from=build /build/app/public /app/web/app/public

COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

RUN mkdir -p /app/data && chown -R node:node /app/data

EXPOSE 3100
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
