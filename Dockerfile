# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=20

# ── base ──────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── development ───────────────────────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development \
    PORT=3000
COPY . .
EXPOSE $PORT
CMD ["npm", "run", "start:dev"]

# ── build ─────────────────────────────────────────────────────────────────────
FROM development AS build
RUN npm run build

# ── prod-deps ─────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

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
