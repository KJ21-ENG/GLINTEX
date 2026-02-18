# Comprehensive Analysis - Local Print Service

- Type: local backend utility service
- Entry: `server.js`
- Role: bridge browser/desktop UI to local printer drivers for silent printing
- API: health, queue, printer listing, print
- Reliability controls: queue size cap, sequential processing, minimum inter-job interval
- Cross-platform print strategy: `lp` (Unix) and PowerShell raw printing (Windows)

