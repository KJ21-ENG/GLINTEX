# Backend Modularization Strategy

Goal: turn `apps/backend/src/index.js` (now partially split into `app.js`/`routes`) into a maintainable API with clear boundaries between routing, business logic, persistence, and integrations.

## Proposed Directory Layout

```
  apps/backend/
  src/
    app.js                 # express app wiring, middleware registration
    server.js              # bootstraps Prisma and starts the HTTP server
    lib/
      prisma.js            # prisma client singleton + helpers
      logger.js            # shared logging util (console or pino/winston)
      error.js             # custom error classes + error responder
    middleware/
      validate.js          # schema validation (zod/yup) wrapper
      errorHandler.js      # consistent API error responses
      asyncHandler.js      # wraps async routes
    services/
      lotService.js
      inboundService.js
      issueService.js
      receiveService.js
      settingsService.js
      whatsappService.js   # wraps whatsapp-web.js client
      barcodeService.js
    routes/
      index.js             # mounts modular routers
      lots.js
      inbound.js
      issue.js
      receive.js
      masters.js           # items/firms/suppliers/machines/operators/bobbins/boxes
      settings.js
      whatsapp.js
      barcodes.js
    utils/
      auditLogger.js       # can stay here but consume lib/prisma
      csvParser.js
      normalization.js
```

## Key Refactors

1. **Bootstrap Separation**
   - Move Express initialization to `src/app.js`, exporting the configured app.
   - Create `src/server.js` that imports the app, reads env vars, connects Prisma, and starts listening.
   - Enables easier testing (import the app without starting the server).

2. **Router Modules**
   - Each domain gets its own router file exporting `Router`.
   - Routes delegate to service layer functions rather than inlining Prisma queries.
   - Shared middleware (validation, async wrapper, error handling) applied at router level.

3. **Service Layer**
   - Encapsulate business logic in `services/*`.
   - Services depend on Prisma (`lib/prisma.js`) and utilities (audit logs, barcode helpers).
   - Facilitates unit tests and reuse (e.g., both HTTP routes and scripts can call the same service).

4. **WhatsApp Isolation**
  - Current `apps/backend/whatsapp/service.js` becomes `services/whatsappService.js`.
   - Routes interact with a high-level interface (connect, status, sendTest, sendEvent).
   - Background jobs/queue processing remain inside the service; consider abstracting storage for auth sessions.

5. **Validation/Error Handling**
   - Introduce schema validation for incoming requests (zod or yup) to replace manual checks.
   - Normalize API errors via custom error classes (e.g., `BadRequestError`, `NotFoundError`) and an Express error handler.

6. **Script Alignment**
  - Revisit scripts in `apps/backend/scripts/` so they import services instead of duplicating logic.
   - Long term: consider a `bin/` folder with CLI commands using the same services.

## Migration Plan

1. Extract Prisma client helper (`lib/prisma.js`) and switch imports.
2. Create `app.js` + `server.js` structure; wire up middleware + error handler.
3. Incrementally move route groups into `routes/` + `services/`, starting with low-risk domains:
   - Masters (items/firms/etc.)
   - Lots & inbound
   - Issue / receive flows
   - Settings / brand
   - WhatsApp endpoints
4. After each migration, ensure tests (or manual validation) cover functionality.
5. Update Dockerfile/entrypoint to run `node src/server.js`.

## Open Questions

- Should WhatsApp queue processing remain in-process or become a worker service?
- How to share DTOs/types between frontend and backend (maybe introduce a shared `packages/types`)?
- Do we want to add authentication/authorization as part of this refactor?

This plan should guide implementation tasks under the “Backend Modularization” milestone from `plan.md`.
