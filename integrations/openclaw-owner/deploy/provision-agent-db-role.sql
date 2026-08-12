\set ON_ERROR_STOP on

DO $provision$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'glintex_owner_agent') THEN
    CREATE ROLE glintex_owner_agent LOGIN;
  END IF;
END
$provision$;

ALTER ROLE glintex_owner_agent NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM glintex_owner_agent;
SELECT format('GRANT CONNECT ON DATABASE %I TO glintex_owner_agent', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO glintex_owner_agent;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM glintex_owner_agent;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM glintex_owner_agent;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO glintex_owner_agent;

GRANT INSERT, UPDATE ON TABLE
  "OwnerTask",
  "AgentLearningCandidate",
  "AgentOperation",
  "AgentAccessLog"
TO glintex_owner_agent;

GRANT INSERT ON TABLE "AuditLog" TO glintex_owner_agent;
