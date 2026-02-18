# Comprehensive Analysis - Backend

- Type: backend API service
- Entry: `src/server.js`; middleware composition in `src/app.js`
- Core router: `src/routes/index.js`; performance router: `src/routes/v2.js`
- Data layer: Prisma client (`src/lib/prisma.js`) with PostgreSQL schema in `prisma/schema.prisma`
- Security: cookie/session auth + role/permission middleware
- Integrations: WhatsApp, Google Drive backup flow, PDF generation, scheduled backup.
- High domain concentration in inventory production flows: cutter/holo/coning issue + receive + trace + dispatch.

