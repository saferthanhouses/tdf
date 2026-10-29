import { sql, type Kysely } from 'kysely'

// How each transaction type counts in the profit and loss report:
//   operating - revenue and expenses, placed in sections by their management category's group
//   capex     - capital expenditure, summed on its own row below operating profit
//   other     - excluded from profit (transfers, owner money, loans, tax); listed as other cash movements
// Editable on the Categories page, so renaming a type doesn't change how it's counted.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema.createType('pnl_role').asEnum(['operating', 'capex', 'other']).execute()
	await db.schema
		.alterTable('transaction_type')
		.addColumn('pnl_role', sql`pnl_role`, col => col.notNull().defaultTo('other'))
		.execute()
	await db.updateTable('transaction_type').set({ pnl_role: 'operating' }).where('name', 'in', ['Income', 'Expense']).execute()
	await db.updateTable('transaction_type').set({ pnl_role: 'capex' }).where('name', '=', 'Asset Purchase').execute()
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.alterTable('transaction_type').dropColumn('pnl_role').execute()
	await db.schema.dropType('pnl_role').execute()
}
