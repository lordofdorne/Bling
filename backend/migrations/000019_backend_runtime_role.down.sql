ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM bling_backend;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE USAGE, SELECT ON SEQUENCES FROM bling_backend;

DO $$
DECLARE
    application_table RECORD;
BEGIN
    FOR application_table IN
        SELECT schemaname, tablename
        FROM pg_policies
        WHERE schemaname = 'public'
          AND policyname = 'bling_backend_all'
    LOOP
        EXECUTE format(
            'DROP POLICY bling_backend_all ON %I.%I',
            application_table.schemaname,
            application_table.tablename
        );
    END LOOP;
END
$$;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM bling_backend;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM bling_backend;
REVOKE USAGE ON SCHEMA public FROM bling_backend;
DROP ROLE IF EXISTS bling_backend;
