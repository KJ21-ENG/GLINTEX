# Build image for the backend API with puppeteer/whatsapp support
FROM node:20-bullseye AS base

# Install Chromium and libraries required by whatsapp-web.js/puppeteer
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
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS deps
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package*.json ./
COPY prisma ./prisma
COPY src ./src
COPY whatsapp ./whatsapp
COPY scripts ./scripts
COPY backups ./backups

RUN mkdir -p /app/.wwebjs_auth && chown -R node:node /app
USER node

ENV PORT=4000
EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
