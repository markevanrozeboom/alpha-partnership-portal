# ── Portal Dockerfile (Express + Vite) ──────────────────────────────────────
# Builds the Vite client bundle and the Express server, then runs the compiled
# server from the dist/ directory.

# ── Stage 1: install all dependencies (dev + prod) ───────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 portaluser

# Install only production deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled server bundle and client assets
COPY --from=builder --chown=portaluser:nodejs /app/dist ./dist

USER portaluser

EXPOSE 5000
ENV PORT=5000

CMD ["node", "dist/index.cjs"]
