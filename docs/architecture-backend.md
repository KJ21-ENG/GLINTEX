# Architecture - Backend

## Executive Summary
Express API with Prisma/PostgreSQL backing the inventory lifecycle across cutter/holo/coning processes.

## Technology Stack
- Node.js, Express, Prisma, PostgreSQL, WhatsApp Web integration

## Architecture Pattern
- Modular monolith with extensive domain logic centralized in route handlers and utility modules.

## Data Architecture
- Prisma schema with masters, transactional process models, and audit/ops entities.
- JSON fields used for flow lineage (`receivedRowRefs`, `sourceRowRefs`).

## API Design
- Main routes under `src/routes/index.js`
- Performance/read routes under `src/routes/v2.js`
- Permission gates enforced per endpoint/module.

## Component Overview
- Middleware, routes, util services (PDF, backup, notifications, auth, permissions)

## Source Tree
- See `source-tree-analysis.md`

## Development Workflow
- Run with nodemon dev script; DB via Docker Compose

## Deployment Architecture
- Backend image installs Chromium and runs Prisma migrate deploy before app start.

## Testing Strategy
- Manual integration checks on production-like flows.

