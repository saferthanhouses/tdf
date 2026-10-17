import { sql, type Kysely } from 'kysely'

// A vendor can appear under several spellings on bank statements (e.g. 'tractor supply' and 'TRACTOR-SUPPLY'),
// so the single match_pattern becomes a list.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable('vendor')
		.addColumn('match_patterns', sql`text[]`, col => col.notNull().defaultTo(sql`'{}'`))
		.execute()
	await sql`UPDATE vendor SET match_patterns = ARRAY[match_pattern]`.execute(db)
	await db.schema.alterTable('vendor').dropColumn('match_pattern').execute()
}

// Keeps only the first pattern of each vendor.
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.alterTable('vendor').addColumn('match_pattern', 'varchar(255)').execute()
	await sql`UPDATE vendor SET match_pattern = COALESCE(match_patterns[1], name)`.execute(db)
	await sql`ALTER TABLE vendor ALTER COLUMN match_pattern SET NOT NULL`.execute(db)
	await db.schema.alterTable('vendor').dropColumn('match_patterns').execute()
}
