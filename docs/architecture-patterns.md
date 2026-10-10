# Architecture Patterns

## Backend
- **Pattern**: Service/API-centric Layered Architecture
- **Description**: Uses Express for routing, Prisma as the ORM data access layer, and organized service modules for business logic (e.g., cron jobs, file uploads, WhatsApp messaging). 

## Frontend
- **Pattern**: Component-based Single Page Application (SPA)
- **Description**: Built with React and structured around reusable UI components. Uses React Router for client-side routing and Tailwind CSS for utility-first styling.

## Print-Client

Retired 2026-10-10. Printing is part of the Electron desktop app (`apps/desktop/src/printing`), with a browser print-dialog fallback; see `docs/label-designer.md`.
