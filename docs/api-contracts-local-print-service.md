# API Contracts - Local Print Service

Service port: `9090`

## Endpoints
- `GET /health` -> service status
- `GET /queue` -> recent print jobs
- `GET /printers` -> available system printers
- `POST /print` -> submit print job

## POST /print Payload
```json
{
  "printer": "Printer Name",
  "content": "raw content",
  "type": "raw"
}
```

## Behavior
- Queues jobs and processes serially.
- Throttles job dispatch (`PRINT_JOB_MIN_INTERVAL_MS`, default `800`).
- Uses OS print commands (`lp` on Unix, PowerShell raw print path on Windows).

