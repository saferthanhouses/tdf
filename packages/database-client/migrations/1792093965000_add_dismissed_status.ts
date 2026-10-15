import { sql, type Kysely } from 'kysely'

// Imported drafts that aren't business transactions are dismissed rather than deleted,
// so their dedupe_hash stays in the table and re-importing an overlapping CSV skips them.
export async function up(db: Kysely<any>): Promise<void> {
	await sql`ALTER TYPE transaction_status ADD VALUE 'dismissed'`.execute(db)
}

// Postgres can't drop an enum value, so the type is rebuilt without it.
export async function down(db: Kysely<any>): Promise<void> {
	await db.deleteFrom('transaction').where('status', '=', 'dismissed').execute()
	await sql`ALTER TYPE transaction_status RENAME TO transaction_status_old`.execute(db)
	await db.schema.createType('transaction_status').asEnum(['draft', 'posted']).execute()
	await sql`
		ALTER TABLE transaction
			ALTER COLUMN status DROP DEFAULT,
			ALTER COLUMN status TYPE transaction_status USING status::text::transaction_status,
			ALTER COLUMN status SET DEFAULT 'draft'
	`.execute(db)
	await db.schema.dropType('transaction_status_old').execute()
}
