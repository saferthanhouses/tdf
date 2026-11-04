import { sql, type Kysely } from 'kysely'

// Email signups from the farm website: where we're selling, what's at market, and farm news.
// One list for now. Unsubscribing keeps the row (with unsubscribed_at set) so we never email them
// again by accident; signing up again clears it.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable('subscriber')
		.addColumn('id', 'serial', col => col.primaryKey())
		.addColumn('email', 'varchar(254)', col => col.notNull().unique())
		.addColumn('source', 'varchar(255)')
		.addColumn('unsubscribe_token', 'uuid', col => col.notNull().unique().defaultTo(sql`gen_random_uuid()`))
		.addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql`now()`))
		.addColumn('unsubscribed_at', 'timestamptz')
		.addCheckConstraint('subscriber_email_normalized', sql`email = lower(btrim(email))`)
		.execute()
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable('subscriber').execute()
}
