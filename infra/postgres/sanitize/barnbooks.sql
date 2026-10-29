-- Scrubs personal data from a restored copy of the barnbooks database (run by restore-test.sh).
--   psql -v ON_ERROR_STOP=1 -d barnbooks -f sanitize/barnbooks.sql
--
-- Kept: dates, amounts, accounts' banks, categories, enterprises, transaction types and how
-- transactions link to vendors, so test data stays realistic.
-- Replaced: vendor names and match texts (they include people's names), bank descriptions, notes,
-- import filenames, account numbers and dedupe hashes (derived from bank descriptions).
--
-- Vendors become 'Vendor <id>' with match texts like 'V000012P01', and each transaction's bank
-- description contains its vendor's first match text, so vendor matching still works on test.

\set ON_ERROR_STOP on

BEGIN;

-- 1. Refuse to run if the schema has text columns nobody has reviewed. A new migration that adds
--    one must also add it here, either sanitized below or listed as safe.
DO $$
DECLARE
	reviewed text[] := ARRAY[
		-- sanitized below
		'account.name', 'import_batch.filename', 'transaction.description', 'transaction.raw_description',
		'transaction.dedupe_hash', 'vendor.name', 'vendor.match_patterns',
		-- safe: fixed reference data or bookkeeping
		'account.bank', 'account.import_format', 'enterprise.name', 'management_category.name',
		'transaction_type.name', 'kysely_migration.name', 'kysely_migration.timestamp', 'kysely_migration_lock.id'
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
		AND c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY', 'bytea')
		AND c.table_name || '.' || c.column_name <> ALL (reviewed);
	IF unreviewed IS NOT NULL THEN
		RAISE EXCEPTION 'sanitize/barnbooks.sql has not reviewed these columns: %', unreviewed
			USING HINT = 'Add each to sanitize/barnbooks.sql: scrub it, or list it as safe.';
	END IF;
END $$;

-- 2. Vendors. Two steps so a real vendor already called 'Vendor 7' can't collide mid-update.
UPDATE vendor SET name = '__sanitizing_' || id;
UPDATE vendor
SET name = 'Vendor ' || id,
	match_patterns = ARRAY(
		SELECT 'V' || lpad(id::text, 6, '0') || 'P' || lpad(n::text, 2, '0')
		FROM generate_series(1, greatest(cardinality(match_patterns), 1)) AS n
		ORDER BY n
	);

-- 3. Transactions.
UPDATE transaction
SET raw_description = CASE
		WHEN raw_description IS NULL THEN NULL
		WHEN vendor_id IS NOT NULL THEN 'CARD PURCHASE V' || lpad(vendor_id::text, 6, '0') || 'P01 #' || id
		ELSE 'BANK TRANSACTION #' || id
	END,
	description = CASE WHEN description = '' THEN '' ELSE 'Note #' || id END,
	dedupe_hash = CASE
		WHEN dedupe_hash IS NULL THEN NULL
		ELSE encode(sha256(convert_to('sanitized:' || id, 'UTF8')), 'hex')
	END;

-- 4. Everything else.
UPDATE import_batch SET filename = 'import-' || id || '.csv' WHERE filename IS NOT NULL;
UPDATE account SET name = regexp_replace(name, '[0-9]+', '#' || id, 'g') WHERE name ~ '[0-9]';

-- 5. Query statistics can hold text from before the scrub.
DO $$
BEGIN
	-- Only when the library is loaded: otherwise there are no statistics, and calling the function errors
	-- (e.g. a dev server restored from production has the extension but doesn't preload it).
	IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements')
		AND current_setting('shared_preload_libraries') ~ '\mpg_stat_statements\M' THEN
		PERFORM pg_stat_statements_reset();
	END IF;
END $$;

-- 6. Check the result before committing.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM vendor WHERE name !~ '^Vendor [0-9]+$'
		OR EXISTS (SELECT 1 FROM unnest(match_patterns) p WHERE p !~ '^V[0-9]{6}P[0-9]{2}$')) THEN
		RAISE EXCEPTION 'vendor rows were not sanitized';
	END IF;
	IF EXISTS (SELECT 1 FROM transaction WHERE raw_description !~ '^(CARD PURCHASE V[0-9]{6}P01|BANK TRANSACTION) #[0-9]+$'
		OR description !~ '^(|Note #[0-9]+)$') THEN
		RAISE EXCEPTION 'transaction rows were not sanitized';
	END IF;
	IF EXISTS (SELECT 1 FROM account WHERE replace(name, '#' || id, '') ~ '[0-9]') THEN
		RAISE EXCEPTION 'account numbers remain';
	END IF;
END $$;

COMMIT;

-- 7. Rewrite the tables so the old row versions (which still hold the original text) are removed
--    from disk, not just hidden.
VACUUM (FULL, ANALYZE) vendor, transaction, import_batch, account;
