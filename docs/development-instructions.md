# Development Instructions

## Dev Environment Setup
1. Prereqs include `node` running globally with `npm` access.
2. Initialize root with `npm install` and enter respective folder inside apps `npm install`.

## Local Development Execution
- `npm run dev:frontend` -> runs frontend via Vite.
- `npm run dev:backend` -> runs backend server using Nodemon on port 3000.
- Check `scripts` in `package.json` for specific individual workspaces.

## Environment Variables
- Setup `.env` referencing `DATABASE_URL` (usually localhost/postgres mappings based on `docker-compose.yml`)

## Working with Prisma
- Standard migration application via `npx prisma migrate dev` running in backend.

## Docker Support
- Dev database usually spun up via `docker-compose.yml` leveraging PostgreSQL volume mappings.
