// Loading P&L layouts and the names their lines are labelled with.
import { sql } from 'kysely'
import { db, type ManagementCategoryGroup } from '@tdf-mono/db-client'
import type { PnlLayoutRow, PnlNames } from './pnl.js'

export const listLayouts = () => db.selectFrom('pnl_layout').select(['id', 'name']).orderBy('position').orderBy('id').execute()

export async function layoutRows(where: { layoutId: number } | { rowId: number }): Promise<PnlLayoutRow[]> {
	let query = db
		.selectFrom('pnl_row')
		.select([
			'id',
			'kind',
			'label',
			'type_ids',
			'category_ids',
			// node-postgres doesn't parse arrays of enums.
			sql<ManagementCategoryGroup[]>`category_groups::text[]`.as('category_groups'),
			'enterprise_ids',
			'account_ids',
			'split_by',
			'total_label',
			'sum_row_ids',
			'emphasis',
			'numerator_row_id',
			'denominator_row_id',
		])
		.orderBy('position')
	query = 'layoutId' in where ? query.where('layout_id', '=', where.layoutId) : query.where('id', '=', where.rowId)
	return (await query.execute()).map(r => ({
		id: r.id,
		kind: r.kind,
		label: r.label,
		typeIds: r.type_ids,
		categoryIds: r.category_ids,
		categoryGroups: r.category_groups,
		enterpriseIds: r.enterprise_ids,
		accountIds: r.account_ids,
		splitBy: r.split_by,
		totalLabel: r.total_label,
		sumRowIds: r.sum_row_ids,
		emphasis: r.emphasis,
		numeratorRowId: r.numerator_row_id,
		denominatorRowId: r.denominator_row_id,
	}))
}

export async function pnlNames(): Promise<PnlNames> {
	const [types, categories, enterprises] = await Promise.all([
		db.selectFrom('transaction_type').select(['id', 'name']).orderBy('id').execute(),
		db.selectFrom('management_category').select(['id', 'name']).orderBy('id').execute(),
		db.selectFrom('enterprise').select(['id', 'name']).orderBy('id').execute(),
	])
	const map = (rows: { id: number; name: string }[]) => new Map(rows.map(r => [r.id, r.name]))
	return { types: map(types), categories: map(categories), enterprises: map(enterprises) }
}
