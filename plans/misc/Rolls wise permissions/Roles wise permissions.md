# Granular Permission System Implementation Plan

## Executive Summary

This plan outlines the implementation of a **process-level and stage-level permission system** for GLINTEX Inventory. The system will allow administrators to assign granular permissions when creating roles, controlling user access to specific processes (Inbound, Issue, Receive, Boiler, Dispatch) and stages (Cutter, Holo, Coning) with three access levels: **None**, **Read-Only**, and **Read-Write**.

---

## Requirements Analysis

### Permission Dimensions

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PERMISSION MATRIX                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  PROCESSES (Primary Modules)              ACCESS LEVELS                 │
│  ─────────────────────────────            ─────────────                 │
│  • Inbound                                0 = None (no access)          │
│  • Issue (stage-dependent)                1 = Read-Only (view only)     │
│  • Receive (stage-dependent)              2 = Read-Write (full access)  │
│  • Boiler                                                               │
│  • Dispatch                                                             │
│                                                                         │
│  STAGES (Sub-permissions for Issue/Receive)                             │
│  ──────────────────────────────────────────                             │
│  • Cutter                                                               │
│  • Holo                                                                 │
│  • Coning                                                               │
│                                                                         │
│  ADDITIONAL MODULES (to consider)                                       │
│  ────────────────────────────────                                       │
│  • Stock (view inventory)                                               │
│  • Reports (view reports)                                               │
│  • Masters (manage lookup data)                                         │
│  • Settings (system configuration)                                      │
│  • Opening Stock (historical data entry)                                │
│  • Box Transfer (inter-box transfers)                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Permission Keys Design

| Permission Key | Description | Scope |
|----------------|-------------|-------|
| `inbound` | Inbound material management | Global |
| `issue.cutter` | Issue to Cutter machines | Stage |
| `issue.holo` | Issue to Holo machines | Stage |
| `issue.coning` | Issue to Coning machines | Stage |
| `receive.cutter` | Receive from Cutter machines | Stage |
| `receive.holo` | Receive from Holo machines | Stage |
| `receive.coning` | Receive from Coning machines | Stage |
| [boiler](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/api/client.js#293-297) | Boiler/Steaming operations | Global |
| `dispatch` | Dispatch to customers | Global |
| `stock` | View stock/inventory | Global |
| `reports` | Access reports module | Global |
| `masters` | Manage master data (items, yarns, machines, etc.) | Global |
| `settings` | Access settings (branding, WhatsApp, etc.) | Global |
| `opening_stock` | Opening stock entry | Global |
| `box_transfer` | Box transfer operations | Global |

### Access Level Values

```javascript
const ACCESS_LEVELS = {
  NONE: 0,      // No access - module/page hidden
  READ: 1,      // Read-only - can view, cannot create/edit/delete
  WRITE: 2,     // Full access - can view and modify
};
```

---

## User Review Required

> [!IMPORTANT]
> Please confirm or clarify the following before implementation:

### 1. Additional Modules
Should the following modules also have permission controls?
- **Stock**: View inventory levels
- **Reports**: Access to production reports, barcode history
- **Masters**: Manage Items, Yarns, Machines, Operators, etc.
- **Opening Stock**: Entry of historical opening balances
- **Box Transfer**: Transfer pieces between boxes
- **Settings**: Branding, WhatsApp configuration, backup settings (currently admin-only)

### 2. Admin Override
Should the `admin` role automatically have full (`WRITE`) access to everything, bypassing permission checks? (Recommended: Yes)

### 3. Stage Selector Behavior
When a user has no permission for a stage (e.g., Cutter):
- **Option A**: Hide the stage from the process selector dropdown entirely
- **Option B**: Show the stage but display "Access Denied" when selected

### 4. Default Role Permissions
What should be the default permissions for newly created roles?
- **Option A**: All `NONE` (explicit grant required)
- **Option B**: All `READ` (can view, but not modify)

### 5. Self-Service Features
Should this implementation also include:
- Self-service password change for users?
- Profile page with session management?

---

## Proposed Database Schema Changes

### Option A: JSON-based Permissions (Recommended)

Store permissions as a JSON object on the Role model. This is flexible and avoids additional tables.

```prisma
model Role {
  id          String   @id @default(cuid())
  key         String   @unique
  name        String
  description String?
  
  // NEW: JSON object storing permission levels
  // Format: { "inbound": 2, "issue.cutter": 1, "dispatch": 0, ... }
  permissions Json     @default("{}")
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @default(now()) @updatedAt
  createdByUserId String?
  updatedByUserId String?
  users       User[]
}
```

**Pros:**
- Simple migration (single column add)
- No schema changes when adding new permission keys
- Fast lookup (no JOINs)

**Cons:**
- No referential integrity for permission keys
- Harder to query "all roles with dispatch access"

### Option B: Normalized Permission Table

```prisma
model RolePermission {
  id           String @id @default(cuid())
  roleId       String
  permissionKey String  // e.g., "inbound", "issue.cutter"
  accessLevel  Int      // 0, 1, or 2
  
  role         Role @relation(fields: [roleId], references: [id], onDelete: Cascade)
  
  @@unique([roleId, permissionKey])
}
```

**Pros:**
- Normalized data
- Easy to query by permission
- Can add permission metadata (description, category)

**Cons:**
- Requires JOINs for every permission check
- More complex migration

### Recommendation: **Option A (JSON)** for simplicity and performance.

---

## Proposed Changes

### Backend Components

---

#### 1. [NEW] `apps/backend/src/utils/permissions.js`

Permission utility functions:
- `PERMISSION_KEYS`: Constant list of all valid permission keys
- `ACCESS_LEVELS`: Enum-like object `{ NONE: 0, READ: 1, WRITE: 2 }`
- `getPermissionLevel(role, key)`: Get access level for a permission key
- `canRead(role, key)`: Returns true if level >= 1
- `canWrite(role, key)`: Returns true if level >= 2
- `normalizePermissions(raw)`: Ensure valid structure, default missing keys to 0

---

#### 2. [MODIFY] [apps/backend/src/middleware/auth.js](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/backend/src/middleware/auth.js)

Add new middleware functions:
- `requirePermission(key, minLevel)`: Check if user has sufficient access
- Attach `req.user.permissions` (parsed from role) for downstream use

```javascript
// Example usage in routes:
router.post('/api/lots', requirePermission('inbound', 2), async (req, res) => { ... });
router.get('/api/db', requirePermission('stock', 1), async (req, res) => { ... });
```

---

#### 3. [MODIFY] [apps/backend/src/routes/index.js](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/backend/src/routes/index.js)

Apply permission middleware to relevant routes:

| Route Pattern | Permission Key | Min Level |
|---------------|----------------|-----------|
| `POST /api/lots` | `inbound` | WRITE |
| `PUT /api/inbound_items/:id` | `inbound` | WRITE |
| `DELETE /api/inbound_items/:id` | `inbound` | WRITE |
| `POST /api/issue_to_cutter_machine` | `issue.cutter` | WRITE |
| `POST /api/issue_to_holo_machine` | `issue.holo` | WRITE |
| `POST /api/issue_to_coning_machine` | `issue.coning` | WRITE |
| `POST /api/receive_from_cutter_machine/*` | `receive.cutter` | WRITE |
| `POST /api/receive_from_holo_machine/*` | `receive.holo` | WRITE |
| `POST /api/receive_from_coning_machine/*` | `receive.coning` | WRITE |
| `POST /api/boiler/*` | [boiler](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/api/client.js#293-297) | WRITE |
| `POST /api/dispatch` | `dispatch` | WRITE |
| `GET /api/dispatch/available/*` | `dispatch` | READ |
| ... | ... | ... |

---

#### 4. [MODIFY] [apps/backend/prisma/schema.prisma](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/backend/prisma/schema.prisma)

Add `permissions` JSON field to Role model.

---

#### 5. [NEW] Migration

```bash
npx prisma migrate dev --name add_role_permissions
```

Migration will:
1. Add `permissions Json @default("{}")` to Role
2. Seed existing roles:
   - `admin`: All permissions set to `2` (WRITE)
   - Other roles: All permissions set to `0` (NONE) or `1` (READ) based on preference

---

### Frontend Components

---

#### 6. [NEW] `apps/frontend/src/utils/permissions.js`

Permission constants and helper functions (mirroring backend):
- `PERMISSION_KEYS`
- `ACCESS_LEVELS`
- `PROCESS_PERMISSIONS`: Maps processes to their permission keys
- `STAGE_PERMISSIONS`: Maps stages to permission keys

---

#### 7. [NEW] `apps/frontend/src/hooks/usePermission.js`

React hook for permission checks:

```javascript
export function usePermission(key) {
  const { user } = useAuth();
  const level = user?.permissions?.[key] ?? 0;
  return {
    level,
    canRead: level >= 1,
    canWrite: level >= 2,
    isHidden: level === 0,
  };
}

export function useStagePermission(process, stage) {
  // Returns combined permission for process.stage
  // e.g., useStagePermission('issue', 'cutter') → checks 'issue.cutter'
}
```

---

#### 8. [MODIFY] [apps/frontend/src/context/AuthContext.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/context/AuthContext.jsx)

Ensure `user.permissions` is available after login:
- Parse permissions from `/api/auth/me` response
- Include in user object

---

#### 9. [MODIFY] [apps/frontend/src/app/router.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/app/router.jsx)

Wrap routes with permission checks or create `<PermissionGate>` component:

```jsx
<Route 
  path="inbound" 
  element={
    <PermissionGate permission="inbound" fallback={<AccessDenied />}>
      <Inbound />
    </PermissionGate>
  } 
/>
```

---

#### 10. [NEW] `apps/frontend/src/components/common/PermissionGate.jsx`

Wrapper component for permission-based rendering:

```jsx
export function PermissionGate({ permission, minLevel = 1, children, fallback }) {
  const { level } = usePermission(permission);
  if (level < minLevel) return fallback || null;
  return children;
}
```

---

#### 11. [MODIFY] [apps/frontend/src/components/layouts/DashboardLayout.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/components/layouts/DashboardLayout.jsx)

Filter navigation items based on permissions:
- Hide nav items user cannot access
- Consider showing with "locked" icon if READ-only

---

#### 12. [MODIFY] [apps/frontend/src/pages/Settings/UserManagement.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Settings/UserManagement.jsx)

Add permission assignment UI when creating/editing roles:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ROLE: Supervisor                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Module Permissions                                                     │
│  ────────────────────────────────────────────────────────────────────   │
│                                                                         │
│  ┌──────────────────┬───────────────────────────────────────────────┐   │
│  │ Module           │ Access Level                                  │   │
│  ├──────────────────┼───────────────────────────────────────────────┤   │
│  │ Inbound          │ ○ None   ○ Read-Only   ● Read-Write          │   │
│  │ Stock            │ ○ None   ● Read-Only   ○ Read-Write          │   │
│  │ Boiler           │ ○ None   ○ Read-Only   ● Read-Write          │   │
│  │ Dispatch         │ ● None   ○ Read-Only   ○ Read-Write          │   │
│  │ Reports          │ ○ None   ● Read-Only   ○ Read-Write          │   │
│  │ Masters          │ ● None   ○ Read-Only   ○ Read-Write          │   │
│  │ Settings         │ ● None   ○ Read-Only   ○ Read-Write          │   │
│  └──────────────────┴───────────────────────────────────────────────┘   │
│                                                                         │
│  Stage-Specific Permissions (Issue & Receive)                           │
│  ────────────────────────────────────────────────────────────────────   │
│                                                                         │
│  ┌──────────────────┬───────────────────────────────────────────────┐   │
│  │ Stage            │ Issue                │ Receive               │   │
│  ├──────────────────┼──────────────────────┼───────────────────────┤   │
│  │ Cutter           │ [▼ Read-Write     ]  │ [▼ Read-Write      ]  │   │
│  │ Holo             │ [▼ Read-Only      ]  │ [▼ Read-Only       ]  │   │
│  │ Coning           │ [▼ None           ]  │ [▼ None            ]  │   │
│  └──────────────────┴──────────────────────┴───────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

#### 13. [MODIFY] Main Page Components

Each page needs to:
1. Check permissions on mount
2. Disable/hide action buttons for READ-only users
3. Show appropriate messages for no access

| Page | Permission Key(s) | Changes |
|------|-------------------|---------|
| [Inbound.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Inbound.jsx) | `inbound` | Hide create/edit/delete buttons if READ |
| [IssueToMachine.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/IssueToMachine.jsx) | `issue.{stage}` | Filter stages in selector; hide form if READ |
| [ReceiveFromMachine.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/ReceiveFromMachine.jsx) | `receive.{stage}` | Filter stages; hide form if READ |
| [Boiler.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Boiler.jsx) | [boiler](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/api/client.js#293-297) | Hide scan/mark buttons if READ |
| [Dispatch.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Dispatch.jsx) | `dispatch` | Hide dispatch form if READ |
| [Stock.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Stock.jsx) | `stock` | View-only, no changes needed |
| [Reports.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Reports.jsx) | `reports` | View-only, no changes needed |
| [Masters.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Masters.jsx) | `masters` | Hide add/edit/delete if READ |
| [Settings.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Settings.jsx) | `settings` | Hide save buttons if READ |
| [OpeningStock.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/OpeningStock.jsx) | `opening_stock` | Hide forms if READ |
| [BoxTransfer.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/BoxTransfer.jsx) | `box_transfer` | Hide transfer form if READ |

---

## Implementation Phases

### Phase 1: Backend Foundation (Estimated: 2-3 hours)

1. Create migration to add `permissions` JSON field to Role
2. Create `permissions.js` utility with constants and helpers
3. Update auth middleware with `requirePermission`
4. Update `/api/auth/me` to return permissions
5. Seed admin role with full permissions

### Phase 2: Backend Route Protection (Estimated: 2-3 hours)

1. Apply `requirePermission` to all mutation routes
2. Add permission checks to read routes where appropriate
3. Test with different role configurations

### Phase 3: Frontend Hooks & Gates (Estimated: 2 hours)

1. Create `usePermission` and `useStagePermission` hooks
2. Create `PermissionGate` component
3. Update `AuthContext` to expose permissions

### Phase 4: Role Management UI (Estimated: 3-4 hours)

1. Design and build permission assignment form
2. Add to role create/edit flow
3. Display current permissions in role list

### Phase 5: Page-Level Integration (Estimated: 4-5 hours)

1. Wrap all page routes with permission gates
2. Update navigation to hide inaccessible items
3. Conditionally render action buttons based on access level

### Phase 6: Stage Selector Integration (Estimated: 2 hours)

1. Filter stages in process selector based on permissions
2. Handle edge cases (no stages accessible)
3. Show appropriate messages

### Phase 7: Testing & Polish (Estimated: 2-3 hours)

1. Create test roles with various permission combinations
2. Verify all routes are protected
3. Verify UI correctly reflects permissions
4. Edge case handling

---

## Verification Plan

### Automated Testing

Currently no test suite exists. Consider adding:
- Jest tests for permission utility functions
- API route tests with mock auth

### Manual Verification

| Test Case | Expected Result |
|-----------|-----------------|
| Admin role accesses all modules | Full access everywhere |
| Role with `inbound: 0` tries to access Inbound | Redirected or "Access Denied" shown |
| Role with `issue.cutter: 1` opens Issue page with Cutter selected | Can view history, form is disabled/hidden |
| Role with `issue.holo: 2, issue.cutter: 0` opens Issue page | Holo stage works, Cutter stage shows denied |
| API call to protected route with insufficient permission | Returns 403 Forbidden |
| Login as non-admin, check Settings > Users & Roles | "Only admins can manage users" message |

---

## File Change Summary

### New Files

| Path | Purpose |
|------|---------|
| `apps/backend/src/utils/permissions.js` | Permission constants and helpers |
| `apps/frontend/src/utils/permissions.js` | Frontend permission utilities |
| `apps/frontend/src/hooks/usePermission.js` | Permission React hooks |
| `apps/frontend/src/components/common/PermissionGate.jsx` | Permission wrapper component |
| `apps/frontend/src/components/common/AccessDenied.jsx` | Access denied display component |
| `apps/backend/prisma/migrations/...` | Database migration |

### Modified Files

| Path | Changes |
|------|---------|
| [apps/backend/prisma/schema.prisma](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/backend/prisma/schema.prisma) | Add `permissions` field to Role |
| [apps/backend/src/middleware/auth.js](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/backend/src/middleware/auth.js) | Add `requirePermission` middleware |
| [apps/backend/src/routes/index.js](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/backend/src/routes/index.js) | Apply permission checks to routes |
| [apps/frontend/src/context/AuthContext.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/context/AuthContext.jsx) | Expose permissions in user object |
| [apps/frontend/src/app/router.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/app/router.jsx) | Wrap routes with permission gates |
| [apps/frontend/src/components/layouts/DashboardLayout.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/components/layouts/DashboardLayout.jsx) | Filter nav by permissions |
| [apps/frontend/src/pages/Settings/UserManagement.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Settings/UserManagement.jsx) | Add permission assignment UI |
| [apps/frontend/src/pages/Inbound.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Inbound.jsx) | Conditional form rendering |
| [apps/frontend/src/pages/IssueToMachine.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/IssueToMachine.jsx) | Stage filtering |
| [apps/frontend/src/pages/ReceiveFromMachine.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/ReceiveFromMachine.jsx) | Stage filtering |
| [apps/frontend/src/pages/Boiler.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Boiler.jsx) | Conditional UI |
| [apps/frontend/src/pages/Dispatch.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Dispatch.jsx) | Conditional UI |
| [apps/frontend/src/pages/Stock.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Stock.jsx) | Permission gate |
| [apps/frontend/src/pages/Reports.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Reports.jsx) | Permission gate |
| [apps/frontend/src/pages/Masters.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Masters.jsx) | Conditional edit UI |
| [apps/frontend/src/pages/Settings.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/Settings.jsx) | Conditional settings UI |
| [apps/frontend/src/pages/OpeningStock.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/OpeningStock.jsx) | Conditional UI |
| [apps/frontend/src/pages/BoxTransfer.jsx](file:///Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/apps/frontend/src/pages/BoxTransfer.jsx) | Conditional UI |

---

## Estimated Total Effort

| Phase | Hours |
|-------|-------|
| Phase 1: Backend Foundation | 2-3 |
| Phase 2: Backend Route Protection | 2-3 |
| Phase 3: Frontend Hooks & Gates | 2 |
| Phase 4: Role Management UI | 3-4 |
| Phase 5: Page-Level Integration | 4-5 |
| Phase 6: Stage Selector Integration | 2 |
| Phase 7: Testing & Polish | 2-3 |
| **Total** | **17-22 hours** |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| **Migration breaks existing roles** | Default all existing non-admin roles to READ for backward compatibility |
| **Admin locked out** | Admin role bypasses permission checks entirely |
| **Performance impact** | Permissions loaded once at login, cached in user object |
| **Inconsistent UI/backend** | Shared permission constants file; test both layers |
| **Forgotten routes** | Audit all routes before release; default-deny for new routes |

---

## Additional Info :-

 Decision | Choice |
|----------|--------|
| Additional Modules | ✅ All included (Stock, Reports, Masters, Settings, Opening Stock, Box Transfer) |
| Admin Override | ✅ Admin bypasses all permission checks |
| Stage Selector | ✅ Option B: Show stage, display "Access Denied" with contact admin prompt |
| Default Permissions | ✅ All READ-WRITE for new and existing roles |
| Multi-Role Support | ✅ Users can have multiple roles assigned |
| Database | ✅ interact with database located in a docker container |
