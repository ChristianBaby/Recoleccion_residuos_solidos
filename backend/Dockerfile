# ── Etapa 1: builder ──────────────────────────────────────────────
# Instala TODAS las dependencias (incluidas las de desarrollo, como
# typescript y prisma CLI) porque las necesitamos para compilar.
FROM node:20-alpine AS builder
WORKDIR /app

# openssl es requerido por los binarios (query engine) de Prisma en Alpine.
RUN apk add --no-cache openssl

# Copiamos primero package.json + el schema de Prisma. El script
# "postinstall" (prisma generate) corre automáticamente al hacer
# "npm ci", y necesita el schema presente para generar el cliente.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Copiamos el resto del código y compilamos TypeScript -> dist/
COPY . .
RUN npm run build

# ── Etapa 2: runner ───────────────────────────────────────────────
# Imagen final, más liviana: no reinstalamos nada, solo copiamos lo
# ya construido desde la etapa "builder".
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

EXPOSE 3001

# "npm start" ejecuta "prisma migrate deploy && node dist/index.js"
# (definido en package.json), así que las migraciones se aplican
# automáticamente en cada arranque del contenedor.
CMD ["npm", "start"]
