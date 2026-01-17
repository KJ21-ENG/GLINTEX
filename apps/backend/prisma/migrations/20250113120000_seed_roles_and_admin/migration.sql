-- Create Roles
INSERT INTO "Role" ("id", "key", "name", "description", "updatedAt") 
VALUES ('role_admin', 'admin', 'Administrator', 'Full system access', NOW()) 
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Role" ("id", "key", "name", "description", "updatedAt") 
VALUES ('role_operator', 'operator', 'Operator', 'Machine operator', NOW()) 
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Role" ("id", "key", "name", "description", "updatedAt") 
VALUES ('role_viewer', 'viewer', 'Viewer', 'Read-only access', NOW()) 
ON CONFLICT ("key") DO NOTHING;

-- Create Admin User if not exists
INSERT INTO "User" ("id", "username", "displayName", "passwordHash", "roleId", "isActive", "updatedAt")
SELECT 'user_admin', 'admin', 'Admin', '$2a$10$sYGpPrugVk/3Yiepov1hMeVebFlOPbzf60FoFf0Be3er2A5zDcAX2', id, true, NOW()
FROM "Role" WHERE "key" = 'admin'
AND NOT EXISTS (SELECT 1 FROM "User" WHERE "username" = 'admin');
