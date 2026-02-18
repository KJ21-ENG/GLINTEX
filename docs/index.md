# Project Documentation Index

## Project Overview

- **Type:** monorepo with 4 parts
- **Primary Language:** JavaScript/Node.js (+ Rust host for desktop)
- **Architecture:** Multi-part system with web app + API + local print pair

## Quick Reference

### Frontend (`frontend`)
- **Type:** web
- **Tech Stack:** React, Vite, Tailwind
- **Root:** `apps/frontend`

### Backend (`backend`)
- **Type:** backend
- **Tech Stack:** Express, Prisma, PostgreSQL
- **Root:** `apps/backend`

### Local Print Service (`local-print-service`)
- **Type:** backend utility
- **Tech Stack:** Express (Node)
- **Root:** `apps/local-print-service`

### Print Client (`print-client`)
- **Type:** desktop
- **Tech Stack:** Tauri, React
- **Root:** `apps/print-client`

## Generated Documentation

- [Project Overview](./project-overview.md)
- [Technology Stack](./technology-stack.md)
- [Architecture Patterns](./architecture-patterns.md)
- [Architecture - Frontend](./architecture-frontend.md)
- [Architecture - Backend](./architecture-backend.md)
- [Architecture - Local Print Service](./architecture-local-print-service.md)
- [Architecture - Print Client](./architecture-print-client.md)
- [Source Tree Analysis](./source-tree-analysis.md)
- [Critical Folders Summary](./critical-folders-summary.md)
- [Integration Architecture](./integration-architecture.md)
- [Component Inventory - Frontend](./component-inventory-frontend.md)
- [Component Inventory - Backend](./component-inventory-backend.md)
- [Component Inventory - Local Print Service](./component-inventory-local-print-service.md)
- [Component Inventory - Print Client](./component-inventory-print-client.md)
- [UI Inventory - Frontend](./ui-component-inventory-frontend.md)
- [UI Inventory - Print Client](./ui-component-inventory-print-client.md)
- [API Contracts - Frontend](./api-contracts-frontend.md)
- [API Contracts - Backend](./api-contracts-backend.md)
- [API Contracts - Local Print Service](./api-contracts-local-print-service.md)
- [Data Models - Frontend](./data-models-frontend.md)
- [Data Models - Backend](./data-models-backend.md)
- [Data Models - Local Print Service](./data-models-local-print-service.md)
- [State Management - Frontend](./state-management-patterns-frontend.md)
- [State Management - Print Client](./state-management-patterns-print-client.md)
- [Asset Inventory - Print Client](./asset-inventory-print-client.md)
- [Development Instructions](./development-instructions.md)
- [Deployment Configuration](./deployment-configuration.md)
- [Contribution Guidelines](./contribution-guidelines.md)
- [Development Guide - Frontend](./development-guide-frontend.md)
- [Development Guide - Backend](./development-guide-backend.md)
- [Development Guide - Local Print Service](./development-guide-local-print-service.md)
- [Development Guide - Print Client](./development-guide-print-client.md)
- [Deployment Guide](./deployment-guide.md)
- [Performance v2 Rollout and Verification Guide](./PERFORMANCE_V2_ROLLOUT.md)
- [v2 Rollout Status](./v2-rollout-status.md)

## Existing Documentation

- [Performance v2 Rollout and Verification Guide](./PERFORMANCE_V2_ROLLOUT.md) - authoritative rollout and parity procedure for v2 APIs

## Getting Started

1. Read [Project Overview](./project-overview.md)
2. Read [Architecture - Backend](./architecture-backend.md) and [Architecture - Frontend](./architecture-frontend.md)
3. Use [Integration Architecture](./integration-architecture.md) for cross-part work
4. Use [API Contracts - Backend](./api-contracts-backend.md) for endpoint-level development
