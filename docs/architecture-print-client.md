# Architecture - Print Client

## Executive Summary
Tauri desktop UI to supervise and control the local print service.

## Technology Stack
- React 19, Vite 7, Tauri v2, Rust host runtime

## Architecture Pattern
- Single-screen operational dashboard with polling and invoke-based control actions.

## Data Architecture
- Local transient state only (status, queue, printers, autostart).

## API Design
- Reads local service endpoints on `localhost:9090`
- Uses Tauri invokes for start/stop service operations

## Component Overview
- Primary `App.jsx` plus minimal static assets/styles.

## Source Tree
- `src/` (UI) + `src-tauri/` (native wrapper)

## Development Workflow
- `npm run dev` and `npm run tauri` in `apps/print-client`

## Deployment Architecture
- Packaged desktop binaries through Tauri build/release workflow.

## Testing Strategy
- Manual desktop lifecycle, autostart toggle, and queue visibility checks.

