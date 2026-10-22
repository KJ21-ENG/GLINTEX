# Add two-sticker holo issue label variant

<!-- Generated from task.json by project-workflow. Do not edit status here directly. -->

Objective: Offer a holo issue label variant with two matching labels on one 75 x 125 mm print, following the coning variant

Status: completed

Owner: user-and-agent

Provider: codex

Scope:
- apps/frontend/src/utils/__tests__/labelEngine.test.mjs
- apps/frontend/src/utils/__tests__/labelTemplateAccess.test.mjs
- apps/frontend/src/utils/label/defaults.js
- apps/frontend/src/utils/labelPrint.js
- docs/label-designer.md

Owned files:
- `apps/frontend/src/pages/Settings/LabelDesigner/index.jsx`
- `apps/frontend/src/utils/__tests__/labelEngine.test.mjs`
- `apps/frontend/src/utils/label/defaults.js`
- `docs/label-designer.md`

Summary:

Added Issue to holo Standard · 2 stickers factory variant: one portrait 75x125 mm label contains two complete identical issue labels separated by a cut line. Uses twistName supplied by actual creation and reprint flows. Added designer actions for missing factory variants in saved stage sets, preserving the active printing choice. Updated label documentation. Local change only; no release or production mutation.

Next action:

Review local changes; release or production deployment requires explicit owner authorization.
