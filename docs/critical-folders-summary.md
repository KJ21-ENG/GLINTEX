# Critical Folders Summary

- `apps/backend/src/routes`: Defines all the endpoints interacting with the Postgres DB through Prisma. Critical for business logic.
- `apps/backend/src/utils`: Reusable operational functionality, most notably backup integration, Google Drive token syncing, and Whatsapp notification templating.
- `apps/backend/prisma`: Central location of the data schema defining relation models heavily interconnected.
- `apps/frontend/src/pages`: Frontend page views connected directly to explicit backend endpoints via fetch functions.
- `apps/print-client/src-tauri`: Necessary Rust integration interacting with OS for specific printer bindings.
