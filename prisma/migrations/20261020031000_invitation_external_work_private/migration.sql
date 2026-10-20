BEGIN;
-- Server-owned fencing/quota state must never be writable through the Data API.
-- The backend connects as the table owner; no client policies are needed.
ALTER TABLE "InvitationExternalWork" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "InvitationExternalWork" FROM PUBLIC;
DO $$
DECLARE
  client_role TEXT;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "InvitationExternalWork" FROM %I', client_role);
    END IF;
  END LOOP;
END
$$;
COMMIT;
