# Development Guide - Local Print Service

## Start
- `cd apps/local-print-service`
- `npm install`
- `npm start`

## Runtime
- Port: `9090`
- Optional env: `PRINT_JOB_MIN_INTERVAL_MS`

## Validation
- Check `GET /health`
- Check available printers via `GET /printers`

