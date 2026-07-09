# ── Etapa 1: deps ─────────────────────────────────────────────────
# Instalar dependencias en su propia capa para que Docker la reutilice
# en caché mientras no cambie package-lock.json.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ── Etapa 2: builder ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Las variables NEXT_PUBLIC_* se incrustan en el bundle del cliente
# durante "next build", por eso deben llegar como ARG (build-time),
# no solo como env var de runtime. Coolify permite definir "Build
# Variables" que se pasan aquí automáticamente.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SOCKET_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL

RUN npm run build

# ── Etapa 3: runner ───────────────────────────────────────────────
# Gracias a "output: standalone" en next.config.ts, .next/standalone
# trae un server.js mínimo con solo los archivos necesarios.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
