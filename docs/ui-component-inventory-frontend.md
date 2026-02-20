# UI Component Inventory (Frontend)

## Categories

### Layout
- `AppLayout`: Standard application layout with sidebar and headers.
- `Sidebar`: Navigation components rendering primary routes.
- `TopBar`: Quick actions and application contexts context block.

### Dashboard & Metrics
- `StatsGrid` / `MetricCard`: Statistical widget to measure units at process.
- `ChartBlocks`: For visual statistics across the timeline (found via lucide-react integration).

### Forms & Interactions
- `DynamicForm`: Abstract form container.
- `SearchableSelect`: Material selection box with search.
- `BarcodeScanner`: Integrated component invoking html5-qrcode.

### Display
- `DataTable` / `TableWithPagination`: List abstractions.
- `Badge`: For status indicating (`Active`, `Received`, `Wastage`).
- `QRPrintCard`: A layout specifically generating the physical label UI or transferring print calls to the desktop.

## State Management
- Utilizing React standard Context API combined with local `useState`/`useReducer`. The frontend acts as a pure SPA interfacing the Backend Express layer via `fetch` HTTP requests with `useEffect` or SWR style custom hooks.
