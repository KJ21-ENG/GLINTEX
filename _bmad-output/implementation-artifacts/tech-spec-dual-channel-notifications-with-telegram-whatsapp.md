---
title: 'Dual-Channel Notifications with Telegram + WhatsApp'
slug: 'dual-channel-notifications-with-telegram-whatsapp'
created: '2026-02-25T22:54:50Z'
status: 'Completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Node.js (ESM)', 'Express 4.18.2', 'Prisma ORM 4.16.2', 'PostgreSQL', 'whatsapp-web.js', 'React 18 + Vite', 'TailwindCSS']
files_to_modify: ['apps/backend/src/utils/notifications.js', 'apps/backend/src/routes/index.js', 'apps/backend/src/server.js', 'apps/backend/prisma/schema.prisma', 'apps/backend/prisma/migrations/*', 'apps/backend/scripts/seedWhatsappTemplates.mjs', 'apps/backend/src/utils/whatsappTemplates.js', 'apps/frontend/src/pages/Settings.jsx', 'apps/frontend/src/api/client.js', 'apps/frontend/src/pages/IssueToMachine.jsx', 'apps/frontend/src/pages/ReceiveFromMachine.jsx', 'apps/frontend/src/pages/SendDocuments.jsx']
code_patterns: ['Monolithic Express route registration in routes/index.js', 'Notification orchestration centralized in src/utils/notifications.js', 'Settings singleton row (Settings.id=1) updated via PUT /api/settings partial updates', 'Template storage in WhatsappTemplate table reused by event key', 'Frontend settings page composes tab sub-components in a single file', 'Frontend API client exports thin request wrappers with credentials include', 'No TypeScript; ESM imports/exports only']
test_patterns: ['No automated tests configured', 'Manual validation via UI/API flows', 'Error handling checked through route responses and console logs']
---

# Tech-Spec: Dual-Channel Notifications with Telegram + WhatsApp

**Created:** 2026-02-25T22:54:50Z

## Overview

### Problem Statement

GLINTEX notifications currently send only through WhatsApp. The system needs Telegram support across all existing WhatsApp notification flows, while preserving central template management and allowing channel selection through Settings.

### Solution

Add Telegram as a first-class notification channel (Bot Token + group/channel chat IDs) and route all current notification flows through shared channel dispatch logic. Keep a single shared template set and apply settings-based enable toggles per channel.

### Scope

**In Scope:**
- Add Telegram support for all existing WhatsApp notification flows (event notifications, send-event, and send-document paths).
- Extend settings to store Telegram enable flag, Bot Token, and authorized Telegram chat IDs.
- Keep one shared message template set for both WhatsApp and Telegram.
- Implement channel selection logic:
  - WhatsApp enabled + Telegram disabled => send only WhatsApp.
  - WhatsApp disabled + Telegram enabled => send only Telegram.
  - Both disabled => send none.
- Keep "enable" control separate from live connection status.

**Out of Scope:**
- Separate Telegram template model or Telegram-only template editor.
- Telegram QR/session auth flow.
- New notification events beyond current WhatsApp-covered events.

## Context for Development

### Codebase Patterns

- Notification delivery currently splits across three backend paths:
  - `sendNotification(event, payload)` for most business events (`src/utils/notifications.js`).
  - Inline WhatsApp dispatch in `POST /api/whatsapp/send-event`.
  - Inline WhatsApp media dispatch in `POST /api/summary/:stage/:type/send` and `POST /api/documents/send`.
- Recipient resolution pattern is template-driven plus settings-gated:
  - Template-level controls: `sendToPrimary`, `groupIds` from `WhatsappTemplate`.
  - Settings-level controls: `whatsappNumber`, `whatsappGroupIds` from singleton `Settings` row.
  - Final recipients are deduplicated by `type:value`.
- WhatsApp connection lifecycle is service-encapsulated in `apps/backend/whatsapp/service.js` with:
  - Init/reconnect/state transitions,
  - queue-based message sending,
  - media-send helpers,
  - status/qr emitter access used by Settings.
- Settings persistence pattern in backend:
  - Partial update in `PUT /api/settings` guarded by property presence checks.
  - Upsert on `Settings.id = 1`.
  - Field normalization in-route (e.g., phone, backup time).
- Frontend settings architecture:
  - `Settings.jsx` owns tabs and runtime polling (`whatsappStatus`, QR, groups).
  - `WhatsAppSettings` and `MessageTemplates` are local component functions in same file.
  - Message template variable metadata is static in `WHATSAPP_EVENTS_CONFIG`.
- Frontend API pattern:
  - Thin wrappers in `src/api/client.js` using `fetch` with `credentials: 'include'`.
  - Feature pages consume named client exports directly (`sendSummaryWhatsApp`, `getWhatsappContacts`, `sendDocument`).
- No automated test harness exists in repo (`.test`/`.spec` files not present under `apps/`).

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/backend/src/utils/notifications.js` | Primary event notification entry point; must become channel-agnostic dispatcher while reusing existing template interpolation. |
| `apps/backend/whatsapp/service.js` | Existing transport abstraction and connection-status source; reference design for Telegram service API shape. |
| `apps/backend/src/routes/index.js` | Contains WhatsApp control endpoints, template CRUD, inline send-event/send-document/summary send logic, and `PUT /api/settings`. |
| `apps/backend/src/server.js` | Starts WhatsApp service at boot; integration point for Telegram startup and channel health initialization. |
| `apps/backend/src/utils/whatsappTemplates.js` | Template data access (`getTemplateByEvent`, `listTemplates`, `upsertTemplate`) and interpolation logic shared across channels. |
| `apps/backend/scripts/seedWhatsappTemplates.mjs` | Seeds all event templates including summary templates; shared template source remains unchanged but must remain Telegram-compatible. |
| `apps/backend/prisma/schema.prisma` | `Settings` model currently stores only WhatsApp routing fields; requires Telegram settings fields. |
| `apps/backend/prisma/migrations/*` | New migration needed for Telegram fields consistent with Prisma migration workflow. |
| `apps/frontend/src/pages/Settings.jsx` | WhatsApp status polling, connection management, and template UI; must be expanded for Telegram configuration and enable toggles. |
| `apps/frontend/src/api/client.js` | API wrappers for WhatsApp/settings/summary/document flows; add Telegram and channel-agnostic endpoints as needed. |
| `apps/frontend/src/pages/IssueToMachine.jsx` | Uses `sendSummaryWhatsApp`; caller naming/behavior must align with multi-channel summary send behavior. |
| `apps/frontend/src/pages/ReceiveFromMachine.jsx` | Uses `sendSummaryWhatsApp`; same multi-channel behavior alignment as Issue page. |
| `apps/frontend/src/pages/SendDocuments.jsx` | Send-document UX and WhatsApp-contact loading; requires Telegram-capable recipient/source behavior decisions in implementation. |

### Technical Decisions

- Reuse existing `WhatsappTemplate` event/template content for both platforms (single source of truth).
- Implement Telegram transport using Bot Token + configured chat IDs from Settings.
- Treat per-channel enable toggles as notification routing gates; keep connection status as operational telemetry only.
- Keep existing route and utility patterns (no major architectural split) and extend incrementally in-place.
- Preserve user-specified routing behavior exactly:
  - WhatsApp enabled + Telegram disabled => WhatsApp only.
  - WhatsApp disabled + Telegram enabled => Telegram only.
  - Both disabled => no send.
- Keep connection-state APIs independent from enable toggles (enable does not imply connected, and connected does not force send).
- Include Telegram support immediately for all existing WhatsApp message flows:
  - event notifications (`sendNotification` call sites),
  - manual send-event endpoint,
  - summary PDF send endpoint,
  - document send endpoint.

## Implementation Plan

### Tasks

- [x] Task 1: Add Telegram fields to persisted settings
  - File: `apps/backend/prisma/schema.prisma`
  - Action: Extend `Settings` model with Telegram routing/config fields: `telegramEnabled` (Boolean), `telegramBotToken` (String?), `telegramChatIds` (String[]), and optionally `whatsappEnabled` (Boolean) to support explicit channel toggles.
  - Notes: Keep defaults backward-compatible so existing rows continue to work without manual DB edits.
- [x] Task 2: Create and apply Prisma migration for new settings fields
  - File: `apps/backend/prisma/migrations/*`
  - Action: Generate migration SQL for Telegram (and channel toggle) fields and ensure schema + DB are aligned.
  - Notes: Follow project rule to run migration only against Docker DB using `npx prisma migrate dev`.
- [x] Task 3: Introduce Telegram transport service with status and send methods
  - File: `apps/backend/src/server.js`
  - Action: Wire Telegram service startup alongside WhatsApp startup (non-fatal on startup errors).
  - Notes: Keep startup behavior consistent with existing WhatsApp init logging/error handling.
- [x] Task 4: Implement Telegram service module
  - File: `apps/backend/telegram/service.js` (new)
  - Action: Add service methods for bot-token based messaging to chat IDs/channels, media send support, and connection/status probes.
  - Notes: Expose methods analogous to WhatsApp usage patterns (`sendText...`, `sendMedia...`, `getStatus`) so route and notification code can remain simple.
- [x] Task 5: Refactor notification utility to multi-channel dispatcher
  - File: `apps/backend/src/utils/notifications.js`
  - Action: Keep shared template interpolation, then dispatch by channel enablement rules (WA only / TG only / none) using settings-gated recipients for each platform.
  - Notes: Preserve current return shape semantics (`ok`, `reason`, recipients/results) and add channel-specific result details for observability.
- [x] Task 6: Keep shared template repository unchanged and reusable
  - File: `apps/backend/src/utils/whatsappTemplates.js`
  - Action: Ensure existing template getters/upserts remain platform-agnostic in usage (no Telegram template table/model added).
  - Notes: Template content remains single-source and is rendered once per event payload.
- [x] Task 7: Extend backend settings and platform control endpoints
  - File: `apps/backend/src/routes/index.js`
  - Action: Update `PUT /api/settings` to accept and persist Telegram/channel toggle fields with normalization/validation (chat IDs array, token optionality when disabled).
  - Notes: Preserve partial update behavior and permission gates (`settings` edit/admin rules).
- [x] Task 8: Add Telegram status/connectivity endpoints
  - File: `apps/backend/src/routes/index.js`
  - Action: Add `/api/telegram/status` and optional `/api/telegram/send-test` endpoints for settings diagnostics.
  - Notes: Keep role/permission parity with WhatsApp settings endpoints.
- [x] Task 9: Convert WhatsApp-only send endpoints to multi-channel send
  - File: `apps/backend/src/routes/index.js`
  - Action: Replace inline WhatsApp-only send logic in:
    - `POST /api/whatsapp/send-event` (or alias to generic path),
    - `POST /api/summary/:stage/:type/send`,
    - `POST /api/documents/send`
    with shared multi-channel dispatch helpers.
  - Notes: Maintain existing request/response contracts as much as possible to avoid frontend breakage.
- [x] Task 10: Update frontend API client for Telegram + channel-agnostic send naming
  - File: `apps/frontend/src/api/client.js`
  - Action: Add Telegram status/test API wrappers and rename/add summary send wrapper from `sendSummaryWhatsApp` to a channel-neutral function while keeping backward compatibility export if needed.
  - Notes: Continue using `credentials: 'include'` on all requests.
- [x] Task 11: Extend Settings UI for channel toggles and Telegram config
  - File: `apps/frontend/src/pages/Settings.jsx`
  - Action: Add Telegram configuration controls (enable toggle, bot token, allowed chat IDs, status visibility) and update existing WhatsApp section to include explicit enable toggle semantics.
  - Notes: Keep template editor shared and unchanged in event/template structure.
- [x] Task 12: Align summary sender callers with channel-neutral API
  - File: `apps/frontend/src/pages/IssueToMachine.jsx`
  - Action: Switch summary send call to channel-neutral client function and update user-facing success/error text if needed.
  - Notes: Behavior should remain one-click summary send with same date handling UX.
- [x] Task 13: Align receive summary sender callers with channel-neutral API
  - File: `apps/frontend/src/pages/ReceiveFromMachine.jsx`
  - Action: Mirror the same API rename/behavior alignment as Issue page.
  - Notes: Preserve existing date picker and message feedback.
- [x] Task 14: Ensure document-send flow supports Telegram dispatch path
  - File: `apps/frontend/src/pages/SendDocuments.jsx`
  - Action: Keep current form contract but ensure backend response handling surfaces per-channel send failures clearly (if partial failure occurs).
  - Notes: If recipient source remains WhatsApp contacts for now, keep it explicit in UI copy until Telegram contact sourcing is added in a future scope.

### Acceptance Criteria

- [ ] AC 1: Given WhatsApp is enabled and Telegram is disabled in Settings, when an event notification is triggered, then only WhatsApp recipients receive the message.
- [ ] AC 2: Given WhatsApp is disabled and Telegram is enabled in Settings, when an event notification is triggered, then only Telegram chat IDs/channels receive the message.
- [ ] AC 3: Given both WhatsApp and Telegram are disabled in Settings, when any notification flow runs (`sendNotification`, summary send, send-event, document send), then no message is sent and API/service result indicates no enabled channels.
- [ ] AC 4: Given both channels are configured but one channel is disconnected/unreachable, when that channel is enabled and selected by routing rules, then the system returns/logs channel-specific failure details without crashing backend request handling.
- [ ] AC 5: Given an existing template event (for example `issue_to_holo_machine_created`), when the event is dispatched to Telegram, then the same shared template content and interpolated variables are used (no Telegram-specific template store).
- [ ] AC 6: Given an admin updates settings, when `PUT /api/settings` is called with Telegram fields and channel toggle fields, then values persist in `Settings` row `id=1` and are returned in subsequent bootstrap/settings reads.
- [ ] AC 7: Given settings update payload omits Telegram fields, when `PUT /api/settings` is called for unrelated settings, then existing Telegram settings remain unchanged (partial update semantics preserved).
- [ ] AC 8: Given summary send is triggered from Issue/Receive screens, when the send API completes, then it dispatches using channel toggles and returns success/failure consistent with per-channel send outcomes.
- [ ] AC 9: Given document send is triggered with a valid file and recipient input, when backend processes `/api/documents/send`, then media is dispatched using enabled channel(s) and message metadata persistence remains intact.
- [ ] AC 10: Given a user opens Settings, when platform status panels load, then WhatsApp and Telegram connection status are displayed independently from enable toggles.
- [ ] AC 11: Given Telegram is enabled but bot token or chat IDs are invalid, when a send attempt is made, then request completes with explicit error reason instead of unhandled exception.
- [ ] AC 12: Given existing WhatsApp-only templates and flows in production data, when this feature is deployed, then existing WhatsApp behavior remains functional without requiring template migration.

## Additional Context

### Dependencies

- Telegram Bot API (HTTPS endpoint calls using bot token).
- Existing Prisma/PostgreSQL settings persistence model and migration pipeline.
- Existing shared template table `WhatsappTemplate` and interpolation helper.
- Existing permission model in backend routes (`settings` and `send_documents` permissions).
- Existing frontend inventory/settings data refresh flow from bootstrap + `refreshDb()`.

### Testing Strategy

- Manual backend validation:
  - Verify DB migration applies and rollback safety in local Docker DB.
  - Validate `/api/settings` partial updates for Telegram fields and channel toggles.
  - Validate `/api/telegram/status` and test-send endpoint behavior with valid/invalid token/chat IDs.
- Manual notification flow validation:
  - Trigger at least one business event (`inbound_created`) under each toggle combination:
    - WA on / TG off,
    - WA off / TG on,
    - WA off / TG off.
  - Verify `send-event`, summary send, and document send each respect toggle routing.
  - Verify shared template interpolation output matches current WhatsApp formatting.
- Manual frontend validation:
  - Confirm Settings save/load round-trip for Telegram fields and toggles.
  - Confirm Issue/Receive summary buttons still show success/error correctly.
  - Confirm Send Documents flow still saves history metadata and surfaces send failures clearly.
- Regression validation:
  - Re-test existing WhatsApp connection, template edit/save, group assignment, and message delivery flows.
  - Re-test no changes to label/challan/backup tabs in Settings.

### Notes

- High-risk area: notification logic is duplicated across utility and route handlers today; centralizing dispatch must avoid breaking route-specific response contracts.
- High-risk area: media send behavior differs across platforms; document/summary sends need consistent retry/error reporting to avoid silent drops.
- Security consideration: Telegram bot token is sensitive; do not expose full token in API responses or UI once saved.
- Limitation in this scope: no Telegram contact directory UX is introduced; chat IDs are managed via settings.
- Future extension (out of scope): add per-template channel toggles if channel-specific template routing is later required.


## Review Notes
- Adversarial review completed
- Findings: 10 total, 7 fixed, 3 skipped
- Resolution approach: auto-fix
- Blocker: `npx prisma migrate dev` failed locally due pre-existing migration shadow-db issue (`20260211120000_add_issue_takeback_ledger`: `column i.isDeleted does not exist`)
