UPDATE "User" 
SET "passwordHash" = '$2a$10$eESs8vLxD9T75Cx/E67uju/aJSv.Vijwxy6/TYKx9TRfXqmWxu2sO',
    "updatedAt" = NOW()
WHERE "username" = 'admin';
