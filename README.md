# GLINTEX Inventory

Vite + React + Tailwind project of the GLINTEX Inventory app.

## Quick Start

```bash
npm i
npm run dev
```

Then open the local URL shown in your terminal.

## Build

```bash
npm run build
npm run preview
```

## Notes

- Data, theme, and branding are stored in localStorage (`glintex_db_v1`, `glintex_theme`).
- Upload your logo from **Admin / Data → Branding**. A default logo is included at `/public/brand-logo.jpg`.
- All create/update/delete actions are now captured in the backend `AuditLog` table. After pulling these changes, run `cd backend && npx prisma migrate dev --name add_audit_log` (or `prisma db push`) so the new table exists, then query it directly or via `npx prisma studio` for a full history of changes.
