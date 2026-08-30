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
COPY whatsapp ./whatsapp
COPY telegram ./telegram
COPY scripts ./scripts
COPY backups ./backups

RUN mkdir -p /app/.wwebjs_auth && chown -R node:node /app
USER node

ENV PORT=4000
EXPOSE 4000

CMD ["sh", "-c", "npx prisma generate && npx prisma migrate deploy && node src/server.js"]
