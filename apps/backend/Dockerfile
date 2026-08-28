# Build image for the backend API with puppeteer/whatsapp support
FROM node:20-bullseye AS base

# Install Chromium and libraries required by whatsapp-web.js/puppeteer
# Also install postgresql-client-17 for pg_dump backups (must match server version)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libasound2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
    libxss1 \
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
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY apps/backend/prisma ./apps/backend/prisma
RUN npm ci
RUN npx --no-install prisma generate --schema apps/backend/prisma/schema.prisma

FROM deps AS production-deps
RUN npm prune --omit=dev

FROM deps AS migrate
WORKDIR /app/apps/backend
CMD ["sh", "-c", "npx --no-install prisma migrate deploy && psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -f prisma/manual/apply_process_pagination_indexes.sql"]

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/package*.json ./
COPY --from=production-deps /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=production-deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY apps/backend/prisma ./apps/backend/prisma
COPY apps/backend/src ./apps/backend/src
COPY apps/backend/whatsapp ./apps/backend/whatsapp
COPY apps/backend/telegram ./apps/backend/telegram
COPY apps/backend/scripts ./apps/backend/scripts

RUN mkdir -p /app/apps/backend/.wwebjs_auth /app/apps/backend/.wwebjs_cache /app/apps/backend/backups /app/apps/backend/logs \
    && chown -R node:node /app
USER node
WORKDIR /app/apps/backend

ENV PORT=4000
EXPOSE 4000

CMD ["node", "src/server.js"]
