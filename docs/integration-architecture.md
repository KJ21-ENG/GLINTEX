# Integration Architecture

## Part Communication

### Frontend -> Backend
- **Type**: REST API over HTTP/HTTPS
- **Data Format**: JSON for requests and responses; Multipart Form Data for CSV/XLSX file uploads (receiving inbound materials from cutter).
- **Authentication**: JWT sent via HTTP-only Cookies (or Authorization header fallback).

### Backend -> Local Services
- **Google Drive APIs**: Used for database dumps/backups configured through `googleapis` integration logic.
- **WhatsApp Web (web.whatsapp.com)**: Puppeteer managed headless browser integration (`whatsapp-web.js`) syncing phone tokens and streaming message triggers internally triggered from REST requests.

### Print-Client -> Backend
- **Type**: Desktop UI interacts with Central API
- **Mechanism**: The React UI wrapper likely pulls from standard central API endpoints while executing local Tauri RPC bindings commands inside Rust to process system level hardware access to barcode label printers.
