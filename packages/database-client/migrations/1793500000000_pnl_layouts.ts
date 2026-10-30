import { sql, type Kysely } from 'kysely'

// P&L layouts: saved, editable report definitions, replacing the fixed report driven by transaction_type.pnl_role.
// A layout is an ordered list of rows:
//   lines   - the posted transactions matching its criteria (each list empty = any), optionally split into one
//             line per category, enterprise or type, with a total line
//   total   - the sum of earlier rows (amounts are signed, so Revenue + Direct costs is the gross margin)
//   percent - one row as a percentage of another
//   heading, spacer - layout only
// The "Standard" layout is seeded from the current pnl_role values so the report is unchanged, then
// pnl_role is dropped.
const groups = ['direct_production', 'selling', 'overhead', 'capital', 'income', 'non_operating']

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema.createType('pnl_row_kind').asEnum(['heading', 'lines', 'total', 'percent', 'spacer']).execute()
	await db.schema.createType('pnl_split').asEnum(['none', 'category', 'enterprise', 'type']).execute()

	await db.schema
		.createTable('pnl_layout')
		.addColumn('id', 'serial', col => col.primaryKey())
		.addColumn('name', 'varchar(255)', col => col.notNull().unique())
		.addColumn('position', 'integer', col => col.notNull().defaultTo(0))
		.execute()

	await db.schema
		.createTable('pnl_row')
		.addColumn('id', 'serial', col => col.primaryKey())
		.addColumn('layout_id', 'integer', col => col.notNull().references('pnl_layout.id').onDelete('cascade'))
		.addColumn('position', 'integer', col => col.notNull())
		.addColumn('kind', sql`pnl_row_kind`, col => col.notNull())
		.addColumn('label', 'varchar(255)', col => col.notNull().defaultTo(''))
		// lines
		.addColumn('type_ids', sql`integer[]`, col => col.notNull().defaultTo(sql`'{}'`))
		.addColumn('category_ids', sql`integer[]`, col => col.notNull().defaultTo(sql`'{}'`))
		.addColumn('category_groups', sql`management_category_group[]`, col => col.notNull().defaultTo(sql`'{}'`))
		.addColumn('enterprise_ids', sql`integer[]`, col => col.notNull().defaultTo(sql`'{}'`))
		.addColumn('account_ids', sql`integer[]`, col => col.notNull().defaultTo(sql`'{}'`))
		.addColumn('split_by', sql`pnl_split`, col => col.notNull().defaultTo('none'))
		.addColumn('total_label', 'varchar(255)')
		// total
		.addColumn('sum_row_ids', sql`integer[]`, col => col.notNull().defaultTo(sql`'{}'`))
		.addColumn('emphasis', 'boolean', col => col.notNull().defaultTo(false))
		// percent
		.addColumn('numerator_row_id', 'integer')
		.addColumn('denominator_row_id', 'integer')
		.execute()
	await db.schema.createIndex('pnl_row_layout_idx').on('pnl_row').columns(['layout_id', 'position']).execute()

	const typesWithRole = async (role: string) =>
		(await db.selectFrom('transaction_type').select('id').where('pnl_role', '=', role).orderBy('id').execute()).map(r => r.id as number)
	// An empty list would mean "any type", so a role no type has matches nothing instead.
	const orNothing = (ids: number[]) => (ids.length ? ids : [0])
	const operating = orNothing(await typesWithRole('operating'))
	const capex = orNothing(await typesWithRole('capex'))
	const other = orNothing(await typesWithRole('other'))

	const seed = async (name: string, position: number, rows: ((ids: number[]) => Record<string, unknown>)[]) => {
		const layout = await db.insertInto('pnl_layout').values({ name, position }).returning('id').executeTakeFirstOrThrow()
		const ids: number[] = []
		for (const [i, row] of rows.entries()) {
			const values = row(ids)
			const { category_groups, ...rest } = values as { category_groups?: string[] }
			const inserted = await db
				.insertInto('pnl_row')
				.values({
					layout_id: layout.id,
					position: i,
					...rest,
					...(category_groups && { category_groups: sql`${sql.lit(`{${category_groups.join(',')}}`)}::management_category_group[]` }),
				})
				.returning('id')
				.executeTakeFirstOrThrow()
			ids.push(inserted.id)
		}
	}
	const lines = (label: string, totalLabel: string, typeIds: number[], categoryGroups: string[] | null, splitBy: string) => () => ({
		kind: 'lines',
		label,
		total_label: totalLabel,
		type_ids: typeIds,
		...(categoryGroups && { category_groups: categoryGroups }),
		split_by: splitBy,
	})
	const total = (label: string, rows: number[], emphasis = false) => (ids: number[]) => ({
		kind: 'total',
		label,
		sum_row_ids: rows.map(i => ids[i]),
		emphasis,
	})
	const percent = (label: string, numerator: number, denominator: number) => (ids: number[]) => ({
		kind: 'percent',
		label,
		numerator_row_id: ids[numerator],
		denominator_row_id: ids[denominator],
	})
	const spacer = () => ({ kind: 'spacer' })

	// Row positions referenced by totals and percents are the indexes in each list.
	await seed('Standard', 0, [
		/* 0 */ lines('Revenue', 'Total revenue', operating, ['income'], 'category'),
		/* 1 */ lines('Direct costs', 'Total direct costs', operating, ['direct_production'], 'category'),
		/* 2 */ total('Gross margin', [0, 1]),
		/* 3 */ percent('Gross margin %', 2, 0),
		/* 4 */ spacer,
		/* 5 */ lines('Selling costs', 'Total selling costs', operating, ['selling'], 'category'),
		/* 6 */ lines('Farm overhead', 'Total farm overhead', operating, groups.filter(g => !['income', 'direct_production', 'selling'].includes(g)), 'category'),
		/* 7 */ total('Operating profit', [2, 5, 6], true),
		/* 8 */ percent('Profit margin %', 7, 0),
		/* 9 */ spacer,
		/* 10 */ lines('Capital expenditure', 'Total capital expenditure', capex, null, 'category'),
		/* 11 */ spacer,
		/* 12 */ lines('Other cash movements (not in profit)', 'Net other cash movements', other, null, 'type'),
	])
	await seed('Gross margin by enterprise', 1, [
		/* 0 */ lines('Revenue', 'Total revenue', operating, ['income'], 'enterprise'),
		/* 1 */ lines('Direct costs', 'Total direct costs', operating, ['direct_production'], 'enterprise'),
		/* 2 */ total('Gross margin', [0, 1], true),
		/* 3 */ percent('Gross margin %', 2, 0),
	])

	await db.schema.alterTable('transaction_type').dropColumn('pnl_role').execute()
	await db.schema.dropType('pnl_role').execute()
}

export async function down(db: Kysely<any>): Promise<void> {
	// Layouts can't be turned back into per-type roles in general; restore the original defaults.
	await db.schema.createType('pnl_role').asEnum(['operating', 'capex', 'other']).execute()
	await db.schema
		.alterTable('transaction_type')
		.addColumn('pnl_role', sql`pnl_role`, col => col.notNull().defaultTo('other'))
		.execute()
	await db.updateTable('transaction_type').set({ pnl_role: 'operating' }).where('name', 'in', ['Income', 'Expense']).execute()
	await db.updateTable('transaction_type').set({ pnl_role: 'capex' }).where('name', '=', 'Asset Purchase').execute()

	await db.schema.dropTable('pnl_row').execute()
	await db.schema.dropTable('pnl_layout').execute()
	await db.schema.dropType('pnl_split').execute()
	await db.schema.dropType('pnl_row_kind').execute()
}
