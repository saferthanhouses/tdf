-- Scrubs personal data from a restored copy of the farm database (run by restore-test.sh).
--   psql -v ON_ERROR_STOP=1 -d farm -f sanitize/farm.sql
--
-- Kept: signup and unsubscribe dates and the page each signup came from.
-- Replaced: email addresses become 'subscriber-<id>@example.com', and unsubscribe tokens are
-- regenerated so a dump can't be used to unsubscribe real people.

\set ON_ERROR_STOP on

BEGIN;

-- 1. Refuse to run if the schema has text columns nobody has reviewed. A new migration that adds
--    one must also add it here, either sanitized below or listed as safe.
DO $$
DECLARE
	reviewed text[] := ARRAY[
		-- sanitized below
		'subscriber.email', 'subscriber.unsubscribe_token',
		-- safe: a path on the farm site
		'subscriber.source',
		'kysely_migration.name', 'kysely_migration.timestamp', 'kysely_migration_lock.id'
	];
	unreviewed text;
BEGIN
	-- Base tables only: views (such as pg_stat_statements) hold no data of their own.
	SELECT string_agg(c.table_name || '.' || c.column_name, ', ' ORDER BY c.table_name, c.column_name)
	INTO unreviewed
	FROM information_schema.columns c
	JOIN information_schema.tables t USING (table_schema, table_name)
	WHERE t.table_type = 'BASE TABLE'
		AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
		-- uuid too: unsubscribe tokens are secrets.
		AND c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY', 'bytea', 'uuid')
		AND c.table_name || '.' || c.column_name <> ALL (reviewed);
	IF unreviewed IS NOT NULL THEN
		RAISE EXCEPTION 'sanitize/farm.sql has not reviewed these columns: %', unreviewed
			USING HINT = 'Add each to sanitize/farm.sql: scrub it, or list it as safe.';
	END IF;
END $$;

-- 2. Subscribers. Two steps so a real address already called 'subscriber-7@example.com' can't
--    collide mid-update.
UPDATE subscriber SET email = '__sanitizing_' || id;
UPDATE subscriber SET email = 'subscriber-' || id || '@example.com', unsubscribe_token = gen_random_uuid();

-- 3. Query statistics can hold text from before the scrub.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements')
		AND current_setting('shared_preload_libraries') ~ '\mpg_stat_statements\M' THEN
		PERFORM pg_stat_statements_reset();
	END IF;
END $$;

-- 4. Check the result before committing.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM subscriber WHERE email !~ '^subscriber-[0-9]+@example\.com$') THEN
		RAISE EXCEPTION 'subscriber rows were not sanitized';
	END IF;
END $$;

COMMIT;

-- 5. Rewrite the table so the old row versions (which still hold the original text) are removed
--    from disk, not just hidden.
VACUUM (FULL, ANALYZE) subscriber;
