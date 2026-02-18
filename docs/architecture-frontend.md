# Architecture - Frontend

## Executive Summary
React + Vite SPA for inventory operations, organized by process modules with permission-gated routes.

## Technology Stack
- React 18, Vite, Tailwind CSS, React Router

## Architecture Pattern
- Route-centric feature modules under a protected app shell.
- Shared UI primitives + domain components.
- Context-based global state and API wrappers for server interactions.

## Data Architecture
- No local persistent DB.
- Normalized server slices in `InventoryContext` from bootstrap/module APIs.

## API Design
- Consumes backend REST (`/api/*`, `/api/v2/*`) through typed wrapper functions.

## Component Overview
- `pages/*` for screens
- `components/common/*` and `components/ui/*` for reusable composition

## Source Tree
- See `source-tree-analysis.md`

## Development Workflow
- Start with `npm run dev:frontend` from repo root.

## Deployment Architecture
- Multi-stage Docker build to Nginx static serving.

## Testing Strategy
- Manual flow validation and endpoint-driven verification.

