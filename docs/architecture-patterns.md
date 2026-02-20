# Architecture Patterns

## Backend
- **Pattern**: Service/API-centric Layered Architecture
- **Description**: Uses Express for routing, Prisma as the ORM data access layer, and organized service modules for business logic (e.g., cron jobs, file uploads, WhatsApp messaging). 

## Frontend
- **Pattern**: Component-based Single Page Application (SPA)
- **Description**: Built with React and structured around reusable UI components. Uses React Router for client-side routing and Tailwind CSS for utility-first styling.

## Print-Client
- **Pattern**: Desktop Application Architecture
- **Description**: A hybrid architecture powered by Tauri, utilizing a Rust-based core for interacting with the OS (system tray, IPC, native printing logic) and a React frontend for the user interface.
