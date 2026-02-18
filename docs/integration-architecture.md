# Integration Architecture

## Part-to-Part Communication

1. frontend -> backend
- Type: REST over HTTP
- Details: `src/api/client.js` and `src/api/v2.js` call `/api/*` and `/api/v2/*`
- Auth mode: cookie credentials (`credentials: include`)

2. backend -> PostgreSQL
- Type: ORM/database
- Details: Prisma client and migrations (`apps/backend/prisma/schema.prisma`)

3. backend -> WhatsApp/Google Drive
- Type: third-party integration
- Details: WhatsApp messaging + template sends, Google Drive backup connect/list

4. print-client -> local-print-service
- Type: REST over localhost
- Details: polling `http://localhost:9090/printers` and `/queue`; submits print operations through service lifecycle controls

5. local-print-service -> OS printer subsystem
- Type: OS command execution
- Details: `lp` (Unix) / PowerShell raw print (Windows)

## Integration Notes
- `apps/print-client` and `apps/local-print-service` are operationally coupled but independent deployment units.
- Core inventory app runtime path remains frontend/backend/db.

