---
project_name: 'GLINTEX'
user_name: 'Kush'
date: '2026-02-20T11:45:00+05:30'
sections_completed:
  ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
rule_count: 21
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

- **Frontend**: React 18.3.1, Vite 5.4.0, TailwindCSS 3.4.9, React Router DOM 6.30.2
- **Backend**: Node.js, Express 4.18.2, Prisma ORM 4.16.2, PostgreSQL
- **Integrations**: `whatsapp-web.js` (github:pedroslopez/whatsapp-web.js#main), `googleapis` 133.0.0, `html5-qrcode` 2.3.8, `jspdf`
- **Architecture**: Monorepo with `apps/frontend` and `apps/backend`

## Critical Implementation Rules

### Language-Specific Rules

- **Pure JavaScript:** The project strictly uses plain JavaScript. Do not write or generate any TypeScript code (no `.ts` or `.tsx` files). Use `.js` or `.jsx` extensions.
- **ES Modules (ESM):** Both backend and frontend are configured with `"type": "module"`. Always use ES module syntax (`import`/`export`) and avoid CommonJS `require()`.
- **Database Migrations:** 
   - ALWAYS run migrations interacting only with the Docker database, never a local database.
   - For local setups, strictly use `npx prisma migrate dev`.
   - For production environments (via SSH/terminal), strictly use `npx prisma migrate deploy`.

### Framework-Specific Rules

- **React Components:** Use functional components inside `src/components/` and `src/pages/`. Design responsively using TailwindCSS classes.
- **Frontend State:** Keep state localized where possible; utilize React Context (under `src/context/`) for global minimal state handling.
- **Backend API Structure:** Append all new routes into the existing monolithic route files (`apps/backend/src/routes/index.js` or `v2.js`) to maintain the single centralized entry point.
- **Authentication:** Cross-origin cookie policies are enforced. Ensure `credentials: 'include'` is set on all `fetch` or Axios requests between frontend and backend.

### Testing Rules

- **No Automated Testing:** Currently, there are no automated testing frameworks configured. AI agents should not generate test files (like `.test.js` or `.spec.js`) unless explicitly instructed to set up a testing environment. 
- **Validation:** Rely on `console.log` debugging and manual validation where necessary.

### Code Quality & Style Rules

- **Component Naming:** Use PascalCase for React components, pages, and their corresponding files (e.g., `AddCustomerModal.jsx`).
- **Function/Variable Naming:** Use camelCase for utilities, hooks, constants, and standard variables.
- **Directory Structure:** Adhere to the existing feature/type separation. Add UI components into `frontend/src/components/`, pages into `pages/`, and backend helpers into `backend/src/utils/` or `services/`.
- **Styling:** Stick strictly to TailwindCSS for styling to keep consistency with the current frontend implementation. No external CSS libraries should be added without permission.

### Development Workflow Rules

- **Execution:** When running scripts for the frontend or backend, always utilize the workspace scripts located in the root `package.json` (e.g., `npm run dev:frontend`, `npm run dev:backend`).
- **Dependencies:** Install packages specifically for their intended workspace using context flags (e.g., `npm install <package> --workspace apps/frontend` or `backend`). Do not dump core application dependencies into the root `package.json`.
- **Database Availability:** Ensure the Docker database setup is operational before making or testing any backend feature changes. Do not interact directly with a local database instance.

### Critical Don't-Miss Rules

- **No TypeScript:** Strictly maintain pure JavaScript (ESM). Do not add `.ts` or `.tsx` extensions, configurations, or type utilities. 
- **Monorepo Package Leaks:** Do not run bare `npm install` root scripts. Ensure you target the correct workspace module (i.e., `npm install <pkg> --workspace apps/<frontend|backend>`).
- **ES Module Enforcement:** Avoid CommonJS `require()`. You must write clean import and export module declarations.
- **Cookie Security:** When communicating with backend endpoints that require session cookies, ensure you use `credentials: 'include'` on the frontend request parameters. 
- **Docker-Only Development:** Do not test migrations or seed databases against local Postgres instances; utilize the project's docker setup for data validation.

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Update this file if new patterns emerge

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review quarterly for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-02-20T11:45:00+05:30
