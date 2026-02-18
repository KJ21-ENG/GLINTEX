# Source Tree Analysis

```text
GLINTEX/
├── apps/
│   ├── frontend/                 # Web UI (React + Vite)
│   │   ├── src/app/              # Router + protected layout shell
│   │   ├── src/pages/            # Route-level feature screens
│   │   ├── src/components/       # Reusable and domain UI components
│   │   ├── src/context/          # Auth and inventory state contexts
│   │   └── src/api/              # Backend API client wrappers
│   ├── backend/                  # Express + Prisma API
│   │   ├── src/routes/           # Main REST handlers and v2 read APIs
│   │   ├── src/middleware/       # Auth/permission middleware
│   │   ├── src/utils/            # Domain helpers (PDF, backup, notifications)
│   │   └── prisma/               # Schema + migrations
│   ├── local-print-service/      # Node print gateway on port 9090
│   │   └── server.js             # Printer discovery and queued print execution
│   └── print-client/             # Tauri desktop print control UI
│       ├── src/                  # React UI
│       └── src-tauri/            # Rust/Tauri config and native bindings
├── docker/                       # DB initialization scripts
├── docs/                         # Generated + operational documentation
├── docker-compose.yml            # Local full stack orchestration
└── package.json                  # Workspace root scripts (frontend/backend)
```

