DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bling_backend') THEN
        CREATE ROLE bling_backend NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
            NOINHERIT NOBYPASSRLS;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO bling_backend;

DO $$
DECLARE
    application_table RECORD;
BEGIN
    FOR application_table IN
        SELECT n.nspname AS schema_name, c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relname <> 'schema_migrations'
    LOOP
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO bling_backend',
            application_table.schema_name,
            application_table.table_name
        );
        IF NOT EXISTS (
            SELECT 1
            FROM pg_policies
            WHERE schemaname = application_table.schema_name
              AND tablename = application_table.table_name
              AND policyname = 'bling_backend_all'
        ) THEN
            EXECUTE format(
                'CREATE POLICY bling_backend_all ON %I.%I FOR ALL TO bling_backend USING (true) WITH CHECK (true)',
                application_table.schema_name,
                application_table.table_name
            );
        END IF;
    END LOOP;
END
$$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bling_backend;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bling_backend;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO bling_backend;

COMMENT ON ROLE bling_backend IS
    'Non-login group for the Bling Go API; DML only, with explicit RLS access.';
