import { sql, type Kysely } from 'kysely'

// Square point-of-sale imports. Square's sales exports are summaries for a date range (gross sales by item
// category, fees, card/cash split), imported into a Square account as one draft per category plus one for fees.
//   square_category - where each Square item category's sales go (management category and enterprise),
//                     remembered between imports like vendor defaults
//   import_batch.period_from/to - the range a Square import covers, so an overlapping one can be refused
export async function up(db: Kysely<any>): Promise<void> {
	await db
		.insertInto('account')
		.values({ name: 'Square', bank: null, import_format: 'square' })
		.onConflict(oc => oc.column('name').doUpdateSet({ import_format: 'square' }))
		.execute()

	await db.schema
		.createTable('square_category')
		.addColumn('id', 'serial', col => col.primaryKey())
		.addColumn('name', 'varchar(255)', col => col.notNull().unique())
		.addColumn('management_category_id', 'integer', col => col.references('management_category.id'))
		.addColumn('enterprise_id', 'integer', col => col.references('enterprise.id'))
		.addColumn('archived', 'boolean', col => col.notNull().defaultTo(false))
		.execute()

	await db.schema
		.alterTable('import_batch')
		.addColumn('period_from', 'date')
		.addColumn('period_to', 'date')
		.execute()
	await sql`ALTER TABLE import_batch ADD CONSTRAINT import_batch_period_check CHECK (period_from <= period_to)`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.alterTable('import_batch').dropConstraint('import_batch_period_check').execute()
	await db.schema.alterTable('import_batch').dropColumn('period_from').dropColumn('period_to').execute()
	await db.schema.dropTable('square_category').execute()
	// The account stays if transactions were imported into it.
	await db
		.deleteFrom('account')
		.where('name', '=', 'Square')
		.where(eb => eb.not(eb.exists(eb.selectFrom('transaction').select('id').whereRef('transaction.account_id', '=', 'account.id'))))
		.execute()
}
