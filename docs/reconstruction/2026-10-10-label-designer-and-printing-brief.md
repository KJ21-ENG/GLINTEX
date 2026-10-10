# Reconstruction brief: Label Designer and label printing

Date: 2026-10-10. Branch `KJ21-ENG/label-designer-v2`, worktree `GLINTEX-label-designer-v2`, base `origin/main` 9f415edc.

## The owner's words (verbatim)

- "it's poorly implemented from the UI/UX perspective"
- "totally reconstruct and refix, or you can say totally redesign, the entire label designing module from the UI/UX perspective"
- "upgrade the entire printing mechanism of the application, like the way the application interacts with the printer and the way it does print, because the current way seems to be very fragile"
- "What is being displayed on a preview in the label designing module is not exactly getting printed with accuracy on the labels"
- "the flexibility of designing itself is quite limited"
- "refer to the Suryaraj polymer project ... I'm only talking about the mechanism ... printing on stickers with accuracy, and designing freedom was also there"
- "doesn't feel professional"
- "do this all P2E for me, and then share with me a recording of your work (demo, actual screen recording)"
- "we will not need the GLINTEX print service anymore, which is Tauri-based ... you can correct me if I'm wrong"
- "work in your own working tree ... push changes to remote main, then production as well"

### Standing preferences already on record

- Verdict-first, short, no-noise replies; operator-first simple designs (memory: feedback-concise-answers).
- Wrap every new save handler in `useSubmitLock`; unsaved-changes navigation guard convention (memory: glintex-submit-guards).
- Keep the Electron print controller, durable queue, printer profile and uncertain-state semantics (verdict accepted by the owner on 2026-10-10).

## Goal, as the owner's outcome

The owner opens Settings → Label designer and designs any stage label the way they would in a real label tool: boxes, fonts, barcodes, lines, logos, in millimetres, reading orientation. The preview on screen is the very document the printer receives, so paper matches the screen. Every stage flow keeps printing exactly as before, through one renderer.

## Scope

- Type: mixed. One page rebuilt from scratch (Label Designer), one rendering engine replaced (label artwork), one transport retired (Tauri print service and TSPL), one transport extended (Electron print queue accepts HTML artifacts).
- In scope: new template model v2 with migration of saved v1 templates; HTML-in-millimetres renderer; Label Designer page; Electron printer and controller v2 artifacts; browser fallback through the OS print dialog; removal of `apps/print-client`, TSPL generation and localhost:9090 discovery; seeds and docs; tests; real-Chromium visual evidence; demo recording.
- Out of scope: physical TE244 calibration on paper (owner's acceptance step); a Windows desktop release build (needs the Windows pipeline; documented as the owner's step); new backend endpoints for real-transaction preview (sample data is generated client-side).

## Contract: must keep working

| Item | Evidence it exists today | How it will be proven after |
|---|---|---|
| 22 stage print call sites use `printStageTemplate` / `printStageTemplatesBatch(stageKey, dataArray, { template, copies, printer })` | grep of apps/frontend/src; docs/desktop/PRINT-CALLER-AUDIT.md | Same exports, same signature; `postCommitCallers.test.mjs` and `labelTemplateAccess.test.mjs` rewritten for v2 keep passing |
| `loadTemplate(stageKey)` throws on 404 with the operator message; never substitutes a default | labelPrint.js loadTemplate | Unit test in `labelTemplateAccess.test.mjs` |
| `LABEL_STAGE_KEYS`, `STAGE_VARIABLES`, `getStageVariables`, barcode makers (`makeReceiveBarcode`, `makeHoloReceiveBarcode`, `makeConingReceiveBarcode`, `parseReceiveCrateIndex`) | imported by receive/stock/issue components | Exports retained unchanged |
| Placeholder syntax `{{key}}` and `@key`, aliases (`barcodeNumber`→`barcode`, `receiveBarcode`→`barcode`, `issueBarcodeNumber`→`issueBarcode`), DD/MM/YYYY for `date`/`inboundDate`, 3-decimal weights | substitutePlaceholders | Unit tests |
| Saved templates in `StickerTemplate` (stageKey unique, dimensions+content JSON) stay loadable; production templates are v1 | prisma schema, PUT/GET routes | Migration v1→v2 tested on every frontend default and every backend seed template |
| Columns repeat one transaction across a row; copies repeat the row; batch advances rows | apps/desktop/src/printing/README.md | Artifact tests; `columnMode` defaults to `repeat` |
| Electron queue: validation, durable records, uncertain states, reprint of retained jobs (v1 PNG records included), permission by `templateSnapshot.stageKey` | controller.cjs, main.cjs, authorization.cjs | Existing print-queue tests kept green; v1 fixtures still accepted; v2 fixtures added |
| Printer profile: explicit printer name, 203/300/600 dpi, microns page size, silent print, zero margins, 100 % scale | electron-printer.cjs | Driver test asserts the same print options for v2 |
| Calibration test label in Workstation setup; preview shows exact artwork | DesktopWorkstation.jsx | Rebuilt on v2 renderer; shows the HTML artwork |
| Settings → Label designer route `settings/label-designer`; settings-write permission to save; sticker-template read permission to load | router.jsx, backend routes | Unchanged |
| Physical sticker orientation for 75×125 landscape stages (text runs bottom-to-top on the portrait page, title bar at the left) | fixture PNGs apps/desktop/test/visual/output | Visual fixtures regenerated from v2 and compared against the geometry of v1 renders |

## Canvas: open to redesign

Template data model; renderer; designer page structure, panels, interactions, copy; element types; font units (real points); coordinate system (reading orientation, page rotation handled by the renderer); wrapping and overflow (explicit boxes, no print-time flow layout); browser transport; docs.

## Tensions and how I resolved them

| Tension | Resolution | Why |
|---|---|---|
| "Keep printing working" vs "retire the Tauri service" | Browser stations fall back to the OS print dialog on the same HTML document; silent printing is desktop-only | One renderer, two transports; nothing depends on localhost:9090 any more |
| "Exact preview" vs "flexible text" | Text is laid out by a JS engine measuring the same fonts, emitted as explicit lines; the preview DOM and the print DOM are the same HTML | Chromium cannot re-wrap what is already positioned |
| "Rebuild from scratch" vs 22 untouched call sites | Public API of labelPrint.js kept, implementation replaced | Blast radius stays inside the label module |
| Desktop release needed vs no Windows build here | Web app ships; desktop stays on 1.1.4 until the owner runs the Windows pipeline; v2 artifacts fail cleanly on 1.1.4 ("Unsupported label artifact"), so the browser fallback is offered meanwhile | Honest about what this machine can build |

## Facts and commitments (not presentation)

Barcode value formats (prefix-series-seq[-Cn]) are unchanged. Stage variable keys are unchanged. Permissions are unchanged.

## Definition of done

### Nothing broke: proven by
- `node --test apps/frontend/src/utils/__tests__/*.test.mjs` green, including rewritten label tests.
- `npm run test:desktop` green with v1 and v2 artifacts.
- `npm run build:frontend` green.
- Real Chromium: every stage default rendered through the v2 renderer in Electron, PNG evidence saved; printToPDF page size equals the media size.
- Backend seed parsed and migrated.

### Meets the owner's bar: judged by
- A reviewer agent judging the designer against the quoted phrases ("professional", "flexibility", "preview = print"), followed by refutation and a fix round.
- The screen recording the owner asked for.

## Constraints

- Advanced workflow: task capsule opened; checkpoints per phase.
- Never commit from the owner's packing checkout; this worktree only.
- Push to `main`, deploy the web app to production (compose rebuild of frontend and backend). The desktop installer is the owner's pipeline.
- Live state: production templates are v1 JSON; desktop 1.1.4 installed on stations; Tauri service 0.2.1 on two stations.

## Direction preview

First outputs shown: rendered v2 defaults for coning_receive and cutter_issue_small, then the designer canvas.

## Execution plan

- Scale: full for the designer page, light for the Electron change.
- Alternatives explored for the designer: (A) three-pane editor like a label tool; (B) form-first with a live preview on the side; (C) wizard per stage. Chosen: A with progressive disclosure, because the owner asked for designing freedom and the users are the owner and supervisors, not line operators.
- Parallelism: builder agents only for the quality loop; heavy jobs serialized (16 GB RAM, load 6).
- Quality loop rounds planned: 1 critique round with two verifiers, 1 fix round, 1 fresh review.
- Real-environment verification: local backend on glintex_dev, Vite dev server, Electron visual runner for artwork; Playwright recording for the demo.
