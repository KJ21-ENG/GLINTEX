# Project Overview

## Description
GLINTEX is a comprehensive ERP/manufacturing management system tracking inventory from initial inbound lot creation across Cutter, Holo, and Coning machine staging into final physical dispatches. 

## Technology Stack
- **Backend:** NodeJS Express, PostgreSQL, Prisma
- **Frontend:** React, Vite, Tailwind
- **Print Proxy:** Rust, Tauri, React

## Classification
- Monorepo containing 3 distinct workspaces (`apps/backend`, `apps/frontend`, `apps/print-client`).

## Architecture Highlights
- Web interface interacting with structured Service/Controller pipelines running standard REST endpoints.
- Desktop proxy for local printing bypasses.
- Whatsapp WebJS integrated notifications triggered inherently on data manipulation. 
