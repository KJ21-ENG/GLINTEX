# Architecture: Backend

## Executive Summary
Provides centralized business logic enforcing permissions and CRUD operations across all tables. Designed securely against `cookie-parser` managed JWTs. 

## Technology Stack
Express framework running standard NodeJS environment, bound explicitly to Prisma ORM connecting downward to PostgreSQL. Employs node-cron for specific scheduled jobs like Backups.

## Architecture Pattern 
Standard Layered Controller-Service Model with robust middleware handling Authentication constraints (`requireAuth`, `requireRole` -> Auth.js).
