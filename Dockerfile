# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=20
ARG PNPM_VERSION=10.33.2

# ── base ──────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# ── deps (offline-fetch then install) ─────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm fetch
RUN pnpm install --offline --frozen-lockfile

# ── development ───────────────────────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development \
    PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE $PORT
CMD ["pnpm", "run", "start:dev"]

# ── build ─────────────────────────────────────────────────────────────────────
FROM development AS build
RUN pnpm run build

# ── prod-deps ─────────────────────────────────────────────────────────────────
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm fetch --prod
RUN pnpm install --offline --frozen-lockfile --prod
RUN pnpm prune --prod

# ── production ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS production
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
RUN addgroup -S app && adduser -S app -G app
COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./
USER app
EXPOSE $PORT
CMD ["node", "dist/main.js"]
