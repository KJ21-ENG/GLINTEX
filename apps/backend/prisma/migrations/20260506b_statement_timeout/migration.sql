-- Apply a per-role statement_timeout so a runaway query never stalls the server.
-- Prisma's PostgreSQL connection string does NOT pass `statement_timeout` to libpq,
-- so we set it on the role itself; new connections from this role inherit it.
-- 30 seconds is generous for any healthy query in this app.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'glintex') THEN
    EXECUTE 'ALTER ROLE glintex SET statement_timeout = ''30s''';
  END IF;
END
$$;
