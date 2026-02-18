# Data Models - Frontend

Frontend has no direct database schema. It consumes backend JSON resources and normalizes them into in-memory stores.

## Primary Client-Side Shapes
- Auth state: `user`, `permissions`, `hasUsers`, `needsBootstrap`.
- Inventory state slices loaded via bootstrap/module APIs:
  - masters: `items`, `yarns`, `cuts`, `twists`, `firms`, `suppliers`, `machines`, `workers`, `bobbins`, `boxes`, `roll_types`, `cone_types`, `wrappers`
  - operations: `lots`, `inbound_items`, issue/receive tables, `issue_take_backs`, `dispatch`, etc.
- Brand/theme state: branding colors/logo/favicon and theme mode.

