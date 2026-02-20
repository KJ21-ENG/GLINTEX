# Source Tree Analysis

## General Structure
The repository is structured as a monorepo containing multiple application components under `apps/`.

```
GLINTEX/
├── apps/
│   ├── backend/          # Express API server connecting to PostgreSQL
│   ├── frontend/         # Vite React SPA for the primary web interface
│   └── print-client/     # Tauri desktop application for local printer proxy
```

## Backend (`apps/backend`)
```
backend/
├── prisma/
│   └── schema.prisma     # Define postgres schema and generate prisma client
├── src/
│   ├── routes/           # Express Route definitions (v1 + v2 router structure)
│   ├── middleware/       # JWT Auth and access level logic
│   ├── utils/            # Math logic, audit log helpers, PDF creators, Barcode generators
│   └── whatsapp/         # WebJS setup for automated WA notifications
└── server.js             # Entrypoint mapping router and executing chron jobs.
```

## Frontend (`apps/frontend`)
```
frontend/
├── src/
│   ├── components/       # Component abstraction: forms, metrics, sidebar
│   ├── pages/            # View logic corresponding to application Routes
│   ├── utils/            # Utility wrappers for date parsing, api fetching
│   └── App.jsx           # Main React App containing react-router declarations
├── index.html            # Vite HTML entry point
└── tailwind.config.js    # Styling definitions 
```

## Print Client (`apps/print-client`)
```
print-client/
├── src/                  # React Vite scaffolding
├── src-tauri/
│   ├── src/main.rs       # Tauri Rust backend for OS integration
│   └── tauri.conf.json   # Configuration for system tray and window properties
└── package.json          # Dependency definition
```
