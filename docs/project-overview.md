# Project Overview

## Project
GLINTEX is a monorepo inventory operations platform with four parts:
- Web frontend
- Backend API + DB model
- Local print service
- Desktop print supervisor client

## Repository Classification
- Type: multi-part monorepo
- Primary language family: JavaScript/Node (plus Rust for Tauri host)

## Functional Scope
- Production workflow tracking across cutter, holo, and coning stages
- Issue/receive lifecycle, dispatch, reporting, box transfer, boiler steaming
- WhatsApp messaging and document dispatch
- Local print operations through dedicated service/client pair
- Performance v2 rollout path for heavy list screens with projection-backed APIs and feature flags

## Key References
- `architecture-frontend.md`
- `architecture-backend.md`
- `architecture-local-print-service.md`
- `architecture-print-client.md`
- `integration-architecture.md`
- `PERFORMANCE_V2_ROLLOUT.md`
- `v2-rollout-status.md`
