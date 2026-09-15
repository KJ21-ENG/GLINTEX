# Other wastage categories

<!-- Generated from task.json by project-workflow. Do not edit status here directly. -->

Objective: Add a category master for Holo other-wastage items, let each item row select a category in Masters > Other Wastage, and replace the Holo daily export Others table with category rows plus totals. Ship to origin/main and production.

Status: completed

Owner: Kush

Provider: openclaw

Scope:
- apps/backend/prisma/schema.prisma, apps/backend/prisma/migrations/*, apps/backend/src/routes/index.js, apps/backend/src/utils/pdf/productionDailyExportData.js, apps/backend/src/utils/pdf/productionDailyExportPdf.js, apps/backend/src/utils/__tests__/productionDailyExport.test.js, apps/frontend/src/pages/Masters.jsx, apps/frontend/src/pages/Reports.jsx, apps/frontend/src/api/client.js, apps/frontend/src/context/InventoryContext.jsx, apps/frontend/src/components/masters/*, docs/*

Summary:

Other wastage categories shipped to production as a170d45 (feature a005aea + bookworm base fix)
