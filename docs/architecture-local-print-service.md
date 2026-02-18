# Architecture - Local Print Service

## Executive Summary
Lightweight local Express service exposing printer control and queued print submission for silent printing.

## Technology Stack
- Node.js, Express, body-parser, CORS

## Architecture Pattern
- Single-process HTTP gateway with in-memory queue and OS command execution.

## Data Architecture
- In-memory queues only; no persistent models.

## API Design
- `/health`, `/queue`, `/printers`, `/print`

## Component Overview
- Queue management and rate-limited job processing
- Cross-platform print dispatch handlers

## Source Tree
- `server.js` as sole application entrypoint

## Development Workflow
- `npm start` from `apps/local-print-service`

## Deployment Architecture
- Meant to run on operator machine or local service host.

## Testing Strategy
- Manual printer connectivity and queue behavior checks.

