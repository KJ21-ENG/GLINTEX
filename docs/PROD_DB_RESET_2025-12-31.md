# Production Database Reset and Master Restore (2025-12-31)

## Summary
Production database was cleared and reinitialized, then master tables and label design data were restored from the provided dump. User/auth tables, settings, and Google Drive credentials were preserved. WhatsApp auth session files were left intact to avoid re-login.

## Target
- Server: `root@72.61.228.188`
- App path: `/var/www/glintex-app`
- DB container: `glintex-app-db-1`
- Backend container: `glintex-app-backend-1`

## Source Backup
- Local dump: `/Volumes/MacSSD/Downloads/20251231_081048_manual.dump`
- Copied to server: `/var/www/glintex-app/apps/backend/backups/20251231_081048_manual.dump`

## Data Preserved
- Auth/settings dump: `/var/www/glintex-app/apps/backend/backups/preserve_auth_settings.dump`
  - Tables: `Role`, `User`, `UserSession`, `Settings`
- Google Drive credentials dump: `/var/www/glintex-app/apps/backend/backups/google_drive_credential.dump`
  - Table: `GoogleDriveCredential`
- WhatsApp auth session directory (left untouched):
  - `/var/www/glintex-app/apps/backend/.wwebjs_auth/session-glintex`

## Steps Performed
1. Copied the dump to the server:
   - `scp /Volumes/MacSSD/Downloads/20251231_081048_manual.dump root@72.61.228.188:/var/www/glintex-app/apps/backend/backups/`
2. Backed up auth/settings and Google Drive credential tables:
   - `pg_dump -t "Role" -t "User" -t "UserSession" -t "Settings"`
   - `pg_dump -t "GoogleDriveCredential"`
3. Dropped and recreated the public schema:
   - `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`
4. Re-applied migrations:
   - `docker run --rm --network glintex-app_default --env-file /var/www/glintex-app/.env glintex-app-backend npx prisma migrate deploy`
5. Restored preserved tables:
   - `pg_restore --data-only /tmp/preserve_auth_settings.dump`
   - `pg_restore --data-only /tmp/google_drive_credential.dump`
6. Restored master tables and label design table from the backup:
   - `Item`, `Yarn`, `Cut`, `Twist`, `Firm`, `Supplier`, `Machine`, `Operator`, `Bobbin`,
     `RollType`, `ConeType`, `Wrapper`, `Box`, `StickerTemplate`
7. Restarted backend container.

## Validation
Record counts after restore:
- `Role`: 2
- `User`: 2
- `UserSession`: 23
- `Settings`: 1
- `GoogleDriveCredential`: 1
- `Item`: 25
- `Yarn`: 1
- `Cut`: 2
- `Twist`: 2
- `Firm`: 3
- `Supplier`: 3
- `Machine`: 4
- `Operator`: 5
- `Bobbin`: 13
- `RollType`: 1
- `ConeType`: 1
- `Wrapper`: 1
- `Box`: 1
- `StickerTemplate`: 8

Transactional tables were empty (confirmed 0 rows for `Lot`, `InboundItem`, Issues, and Receives).

## Outcome
- Database reset complete with only masters + label templates restored.
- Users, roles, sessions, settings, and Google Drive credentials preserved.
- WhatsApp login not required (auth session preserved on disk).

## Cleanup (Optional)
Temporary files inside the DB container:
- `/tmp/20251231_081048_manual.dump`
- `/tmp/preserve_auth_settings.dump`
- `/tmp/google_drive_credential.dump`
