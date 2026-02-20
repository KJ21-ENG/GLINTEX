# API Contracts

## Backend APIs

### General Structure
The backend provides APIs nested under `/api/` and `/api/v2/`. It handles operations for all manufacturing stages: Inbound, Cutter, Holo, and Coning. It also provides management for master data (Firm, Item, Machine, Operator, Sequence, etc.) and utilities like Boiler Steaming logs and WhatsApp integrations.

### Key Endpoint Groups
*   **Inbound**: Receiving raw material/lot inventory (`/api/inbound...`)
*   **Cutter Machine**: Issue to Cutter (`/api/issue-cutter...`), Receive from Cutter (`/api/receive-cutter...`)
*   **Holo Machine**: Issue to Holo (`/api/issue-holo...`), Receive from Holo (`/api/receive-holo...`)
*   **Coning Machine**: Issue to Coning (`/api/issue-coning...`), Receive from Coning (`/api/receive-coning...`)
*   **Take-Backs (Reversible Issues)**: Endpoints to return partially or unused materials from machines back to stock.
*   **Boiler Steam Log**: Logging steamed Holo rolls (`/api/boiler...`).
*   **Dispatches**: Discarding or selling finished goods to customers (`/api/dispatch...`).
*   **Box Transfers**: Moving goods between boxes (`/api/box-transfer...`).
*   **Data Models & Master Routes**: `items`, `firms`, `suppliers`, `yarns`, `cuts`, `twists`, `machines`, `operators`, etc.
*   **Auth**: Login, sessions, roles, and permissions management.
*   **Exports & Utilities**: CSV/Excel downloads, PDF generation, Google Drive backup.

*(Endpoints dynamically handled by `routes/index.js` and `routes/v2.js`)*
