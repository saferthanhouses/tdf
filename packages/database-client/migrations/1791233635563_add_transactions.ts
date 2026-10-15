import { sql, type Kysely } from 'kysely'

// Seed data copied from barnbooks/constants.ts and barnbooks/analysis.ts at the time of migration.
const transactionTypes = [
	'Expense',
	'Income',
	'Asset Purchase',
	'Transfer',
	'Owner Contribution',
	'Owner Draw',
	'Loan Proceeds',
	'Loan Principal',
	'Tax Payment',
]

const managementCategoriesByGroup: Record<string, string[]> = {
	direct_production: [
		'Feed',
		'Purchased livestock / chicks',
		'Processing',
		'Veterinary / medicine',
		'Bedding',
		'Seed / plants',
		'Packaging',
		'Other direct production',
		'Ingredients',
		'Labels / printed material',
		'Commercial Kitchen Rent',
	],
	selling: [
		'Market fees',
		'Merchant / card processing fees',
		'Delivery / freight',
		'Advertising',
		'Website / e-commerce',
		'Transportation Costs - Tolls',
		'Transportation Costs - Fuel',
	],
	overhead: [
		'Fuel',
		'Repairs & maintenance',
		'Small tools',
		'Utilities',
		'Insurance',
		'Professional fees',
		'Property-related farm expenses',
		'General farm supplies',
		'Labor / payroll',
		'Vehicle',
		'LGD Supplies',
		'Loan activity',
		'Tax payment',
	],
	capital: [
		'Equipment purchase',
		'Buildings',
		'Permanent fencing',
		'Water systems',
		'Land improvement',
		'Orchard / perennial establishment',
		'Vehicle purchase',
		'Other capital asset',
	],
	income: [
		'Farm product sales',
		'Livestock sales',
		'Prepared food sales',
		'Breeding stock sales',
		'Agrotourism income',
		'Market Sales',
		'Farmgate Sales',
	],
	non_operating: ['Bank transfer', 'Owner funds'],
}

const enterprises = [
	'Beef',
	'Lamb',
	'Feeder Pigs',
	'Breeder Pigs',
	'Broilers',
	'Eggs',
	'Ducks',
	'Prepared / Value-added',
	'Orchard / Perennials',
	'Agrotourism',
	'Farm-wide',
	'Farmers Markets',
	'Guardian Dogs',
]

const accounts = [
	{ name: 'Capital One - 9171', bank: 'Capital One', import_format: 'capital_one' },
	{ name: 'DNBD - 6521', bank: 'DNBD', import_format: 'dnbd' },
	{ name: 'Cash', bank: null, import_format: null },
]

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable('account')
		.addColumn('import_format', 'varchar(50)')
		.execute()
	await db.schema.alterTable('account').addUniqueConstraint('account_name_unique', ['name']).execute()

	await db.schema
		.createTable('transaction_type')
		.addColumn('id', 'serial', col => col.primaryKey())
		.addColumn('name', 'varchar(255)', col => col.notNull().unique())
		.addColumn('archived', 'boolean', col => col.notNull().defaultTo(false))
		.execute()

	await db.schema
		.createType('management_category_group')
		.asEnum(['direct_production', 'selling', 'overhead', 'capital', 'income', 'non_operating'])
		.execute()

	await db.schema
		.createTable('management_category')
		.addColumn('id', 'serial', col => col.primaryKey())
		.addColumn('name', 'varchar(255)', col => col.notNull().unique())
		.addColumn('group', sql`management_category_group`, col => col.notNull())
		.addColumn('archived', 'boolean', col => col.notNull().defaultTo(false))
		.execute()

	await db.schema
		.createTable('enterprise')
		.addColumn('id', 'serial', col => col.primaryKey())
		.addColumn('name', 'varchar(255)', col => col.notNull().unique())
		.addColumn('archived', 'boolean', col => col.notNull().defaultTo(false))
		.execute()

	await db.schema
		.createTable('vendor')
		.addColumn('id', 'serial', col => col.primaryKey())
		.addColumn('name', 'varchar(255)', col => col.notNull().unique())
		// Case-insensitive substring matched against the bank description; the longest match wins.
		.addColumn('match_pattern', 'varchar(255)', col => col.notNull())
		.addColumn('default_transaction_type_id', 'integer', col => col.references('transaction_type.id'))
		.addColumn('default_management_category_id', 'integer', col => col.references('management_category.id'))
		.addColumn('default_enterprise_id', 'integer', col => col.references('enterprise.id'))
		.execute()

	await db.schema
		.createTable('import_batch')
		.addColumn('id', 'serial', col => col.primaryKey())
		.addColumn('account_id', 'integer', col => col.notNull().references('account.id'))
		.addColumn('filename', 'varchar(255)')
		.addColumn('imported_at', 'timestamptz', col => col.notNull().defaultTo(sql`now()`))
		.execute()

	await db.schema
		.createType('transaction_status')
		.asEnum(['draft', 'posted'])
		.execute()

	await db.schema
		.createTable('transaction')
		.addColumn('id', 'serial', col => col.primaryKey())
		.addColumn('status', sql`transaction_status`, col => col.notNull().defaultTo('draft'))
		.addColumn('date', 'date', col => col.notNull())
		.addColumn('account_id', 'integer', col => col.notNull().references('account.id'))
		.addColumn('transaction_type_id', 'integer', col => col.references('transaction_type.id'))
		.addColumn('vendor_id', 'integer', col => col.references('vendor.id').onDelete('set null'))
		.addColumn('management_category_id', 'integer', col => col.references('management_category.id'))
		.addColumn('enterprise_id', 'integer', col => col.references('enterprise.id'))
		// Negative = money out of the account, positive = money in.
		.addColumn('amount', 'numeric(12, 2)', col => col.notNull())
		.addColumn('description', 'text', col => col.notNull().defaultTo(''))
		.addColumn('raw_description', 'text')
		.addColumn('import_batch_id', 'integer', col => col.references('import_batch.id').onDelete('set null'))
		.addColumn('dedupe_hash', 'varchar(64)', col => col.unique())
		.addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql`now()`))
		.addColumn('posted_at', 'timestamptz')
		.execute()

	await db.schema.createIndex('transaction_status_date_idx').on('transaction').columns(['status', 'date']).execute()

	await db.insertInto('transaction_type').values(transactionTypes.map(name => ({ name }))).execute()
	await db
		.insertInto('management_category')
		.values(
			Object.entries(managementCategoriesByGroup).flatMap(([group, names]) =>
				names.map(name => ({ name, group })),
			),
		)
		.execute()
	await db.insertInto('enterprise').values(enterprises.map(name => ({ name }))).execute()
	await db
		.insertInto('account')
		.values(accounts)
		.onConflict(oc => oc.column('name').doUpdateSet(eb => ({ import_format: eb.ref('excluded.import_format') })))
		.execute()
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable('transaction').execute()
	await db.schema.dropType('transaction_status').execute()
	await db.schema.dropTable('import_batch').execute()
	await db.schema.dropTable('vendor').execute()
	await db.schema.dropTable('enterprise').execute()
	await db.schema.dropTable('management_category').execute()
	await db.schema.dropType('management_category_group').execute()
	await db.schema.dropTable('transaction_type').execute()
	await db.deleteFrom('account').where('name', 'in', accounts.map(a => a.name)).execute()
	await db.schema.alterTable('account').dropConstraint('account_name_unique').execute()
	await db.schema.alterTable('account').dropColumn('import_format').execute()
}
