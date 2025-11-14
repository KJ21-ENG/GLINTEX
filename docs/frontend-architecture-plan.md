# Frontend Architecture Cleanup

Objective: replace the single-component `App.jsx` pattern with a scalable structure that supports routing, feature isolation, and better data management.

## Proposed Directory Layout

```
apps/frontend/src/
  app/
    App.tsx (or .jsx)      # shell w/ Suspense + layout
    router.jsx             # React Router config
    providers.jsx          # QueryClientProvider, BrandProvider, etc.
  layout/
    MainLayout.jsx         # header/nav + outlet
    ThemeToggle.jsx
  features/
    inbound/
      components/
      hooks/
      api.ts
      routes.tsx
      index.ts
    stock/
    issue/
    receive/
    masters/
    reports/
    settings/
  components/
    ui/                    # generic buttons, inputs, modals
    data-display/          # tables, pagination, popovers
  lib/
    api-client.ts          # fetch wrapper
    query-client.ts        # react-query setup
    formatters.ts
    constants.ts
  context/
    brandContext.tsx       # (or move into app/providers)
  styles/
    globals.css
  types/
    db.ts                  # normalized data types
```

## Key Changes

1. **Routing & Layout**
   - Use `react-router-dom` to map URLs to features (`/inbound`, `/stock`, etc.).
   - Replace tab state with `<NavLink>` inside `MainLayout`; last tab persistence becomes browser history.
   - Keep header/theme toggle in layout; content rendered via `<Outlet>`.

2. **Feature Isolation**
   - Each feature folder contains:
     - Route component(s) + loader/actions (if needed).
     - Hooks for domain-specific state (`useInbound`, `useReceivePreview`).
     - API helpers that wrap shared `api-client`.
     - Local component subfolder for feature-specific UI.
   - Shared UI remains under `components/ui` and `components/data-display`.

3. **Data Fetching Strategy**
   - Introduce React Query (TanStack Query) or SWR.
   - Create `QueryClientProvider` in `app/providers.jsx`.
   - Each feature queries only the data it needs; mutations invalidate relevant caches instead of refetching the entire DB.
   - Keep `normalizeDb` logic but move it server-side where possible; client stores normalized slices.

4. **State Management**
   - Brand/theme context stays, but global DB state is removed.
   - Use derived selectors or React Query selectors for computed values (e.g., available stock counts).

5. **Module Consistency**
   - Convert utilities to pure ES modules (no inline `require`).
   - Consider TypeScript for type safety; if staying JS, add JSDoc typedefs.

6. **Testing & Storybook (Optional)**
   - After restructuring, add component tests per feature and optionally Storybook for UI validation.

## Migration Plan

1. Introduce React Router + layout while keeping existing pages; map each tab to a route (e.g., `/app/inbound`).
2. Gradually move logic from `App.jsx` into feature routes; keep API handlers localized.
3. Add React Query and migrate data fetching per feature (starting with read-only pages like Stock/Reports).
4. Clean up shared components/utilities into the new folder structure.
5. Remove tab state + full DB fetch once all routes own their data.
6. Update entry files (`main.jsx`) to use new providers/router.

## Considerations

- Evaluate whether any state should live in localStorage (e.g., theme) vs. query cache.
- Ensure exports remain stable during migration (barrel files can be reintroduced once folders settle).
- Keep existing Tailwind setup but relocate CSS to `apps/frontend/src/styles/globals.css`.

This document is the blueprint for the "Frontend Architecture Cleanup" milestone in `plan.md`.
