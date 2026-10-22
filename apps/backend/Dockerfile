# Backend API and Telegram notifications; no browser runtime required.
# Base stays on Debian bookworm: bullseye is EOL and its security pool no longer
# serves the packages this image installs.
FROM node:20-bookworm AS base

# PostgreSQL client 17 is required for database backups.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    gnupg \
    lsb-release \
    && wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS deps
COPY package*.json ./
COPY prisma ./prisma
RUN npm install --omit=dev
RUN npx prisma generate

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package*.json ./
COPY prisma ./prisma
COPY src ./src
COPY telegram ./telegram
COPY scripts ./scripts

RUN mkdir -p /app/backups /app/logs && chown -R node:node /app
USER node

ENV PORT=4000
EXPOSE 4000

CMD ["sh", "-c", "npx prisma generate && npx prisma migrate deploy && node src/server.js"]
