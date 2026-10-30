import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { sql, type Transaction } from 'kysely'
import { z } from 'zod'
import { db, type Database } from '@tdf-mono/db-client'
import { layoutCoverage, rowTotals, type PnlLayoutRow } from '../reports/pnl.js'
import { layoutRows, listLayouts, loadAggregates, pnlNames } from '../reports/layouts.js'

const id = z.coerce.number().int().positive()
const name = z.string().trim().min(1).max(255)
const ids = z.array(z.number().int().positive()).default([])
const groups = ['direct_production', 'selling', 'overhead', 'capital', 'income', 'non_operating'] as const

// Rows as the editor sends them. `key` is the row's id as a string for saved rows, or any other unique string
// for new ones; totals and percents refer to other rows by key.
const rowInput = z.object({
	key: z.string().min(1).max(64),
	kind: z.enum(['heading', 'lines', 'total', 'percent', 'spacer']),
	label: z.string().trim().max(255).default(''),
	typeIds: ids,
	categoryIds: ids,
	categoryGroups: z.array(z.enum(groups)).default([]),
	enterpriseIds: ids,
	accountIds: ids,
	splitBy: z.enum(['none', 'category', 'enterprise', 'type']).default('none'),
	totalLabel: z.string().trim().max(255).nullable().default(null),
	sumRowKeys: z.array(z.string()).default([]),
	emphasis: z.boolean().default(false),
	numeratorKey: z.string().nullable().default(null),
	denominatorKey: z.string().nullable().default(null),
})
type RowInput = z.infer<typeof rowInput>
const rowsInput = z.array(rowInput).max(200)

function notFound(): never {
	throw new HTTPException(404, { message: 'Not found' })
}

// Totals and percents may only use lines and totals above them, so a layout always reads top to bottom.
function checkReferences(rows: RowInput[]) {
	const keys = new Set<string>()
	rows.forEach((row, i) => {
		if (keys.has(row.key)) throw new HTTPException(400, { message: `Two rows share the key "${row.key}"` })
		keys.add(row.key)
		const refs = row.kind === 'total' ? row.sumRowKeys : row.kind === 'percent' ? [row.numeratorKey, row.denominatorKey] : []
		for (const ref of refs) {
			const target = rows.findIndex(r => r.key === ref)
			if (ref === null || target < 0 || target >= i || !['lines', 'total'].includes(rows[target]!.kind))
				throw new HTTPException(400, { message: `“${row.label || row.kind}” must use lines or totals above it` })
		}
	})
}

const fields = (r: RowInput, position: number) => ({
	position,
	kind: r.kind,
	label: r.label,
	type_ids: r.typeIds,
	category_ids: r.categoryIds,
	category_groups: sql<string[]>`${sql.val(`{${r.categoryGroups.join(',')}}`)}::management_category_group[]`,
	enterprise_ids: r.enterpriseIds,
	account_ids: r.accountIds,
	split_by: r.splitBy,
	total_label: r.totalLabel || null,
	emphasis: r.emphasis,
	// References are set once every row has an id.
	sum_row_ids: [],
	numerator_row_id: null,
	denominator_row_id: null,
})

// Replace a layout's rows. Rows that keep their key keep their id, so ledger links to them stay valid.
async function saveRows(trx: Transaction<Database>, layoutId: number, rows: RowInput[]) {
	checkReferences(rows)
	const existing = new Set((await trx.selectFrom('pnl_row').select('id').where('layout_id', '=', layoutId).execute()).map(r => r.id))
	const idOf = new Map<string, number>()
	for (const [i, r] of rows.entries()) {
		const keep = /^\d+$/.test(r.key) && existing.has(Number(r.key)) ? Number(r.key) : null
		if (keep !== null) {
			// Cast needed: kysely can't type the enum-array expression against the column.
			await trx.updateTable('pnl_row').set(fields(r, i) as never).where('id', '=', keep).execute()
			idOf.set(r.key, keep)
		} else {
			const inserted = await trx
				.insertInto('pnl_row')
				.values({ layout_id: layoutId, ...fields(r, i) } as never)
				.returning('id')
				.executeTakeFirstOrThrow()
			idOf.set(r.key, inserted.id)
		}
	}
	const kept = [...idOf.values()]
	await trx
		.deleteFrom('pnl_row')
		.where('layout_id', '=', layoutId)
		.$if(kept.length > 0, q => q.where('id', 'not in', kept))
		.execute()
	for (const r of rows) {
		if (r.kind !== 'total' && r.kind !== 'percent') continue
		await trx
			.updateTable('pnl_row')
			.set({
				sum_row_ids: r.kind === 'total' ? r.sumRowKeys.map(k => idOf.get(k)!) : [],
				numerator_row_id: r.kind === 'percent' ? idOf.get(r.numeratorKey!)! : null,
				denominator_row_id: r.kind === 'percent' ? idOf.get(r.denominatorKey!)! : null,
			})
			.where('id', '=', idOf.get(r.key)!)
			.execute()
	}
}

// Saved rows in the editor's shape.
const toInput = (r: PnlLayoutRow): RowInput => ({
	key: String(r.id),
	kind: r.kind,
	label: r.label,
	typeIds: r.typeIds,
	categoryIds: r.categoryIds,
	categoryGroups: r.categoryGroups,
	enterpriseIds: r.enterpriseIds,
	accountIds: r.accountIds,
	splitBy: r.splitBy,
	totalLabel: r.totalLabel,
	sumRowKeys: r.sumRowIds.map(String),
	emphasis: r.emphasis,
	numeratorKey: r.numeratorRowId === null ? null : String(r.numeratorRowId),
	denominatorKey: r.denominatorRowId === null ? null : String(r.denominatorRowId),
})

// The editor's rows as the report engine's, with keys standing in for ids.
const toLayoutRows = (rows: RowInput[]): PnlLayoutRow[] => {
	const num = new Map(rows.map((r, i) => [r.key, i + 1]))
	return rows.map(r => ({
		id: num.get(r.key)!,
		kind: r.kind,
		label: r.label,
		typeIds: r.typeIds,
		categoryIds: r.categoryIds,
		categoryGroups: r.categoryGroups,
		enterpriseIds: r.enterpriseIds,
		accountIds: r.accountIds,
		splitBy: r.splitBy,
		totalLabel: r.totalLabel,
		sumRowIds: r.sumRowKeys.map(k => num.get(k) ?? -1),
		emphasis: r.emphasis,
		numeratorRowId: r.numeratorKey === null ? null : (num.get(r.numeratorKey) ?? -1),
		denominatorRowId: r.denominatorKey === null ? null : (num.get(r.denominatorKey) ?? -1),
	}))
}

export const pnlLayouts = new Hono()
	// Layouts with their rows (the ledger uses these to label a P&L line it's filtered to; the editor edits them).
	.get('/', async c => {
		const layouts = await listLayouts()
		return c.json(await Promise.all(layouts.map(async l => ({ ...l, rows: await layoutRows({ layoutId: l.id }) }))))
	})

	// A new layout: empty, or a copy of another.
	.post('/', async c => {
		const body = z.object({ name, copyFrom: id.optional() }).parse(await c.req.json())
		const created = await db.transaction().execute(async trx => {
			const position = (await trx.selectFrom('pnl_layout').select(sql<number>`coalesce(max(position), -1) + 1`.as('next')).executeTakeFirstOrThrow()).next
			const layout = await trx.insertInto('pnl_layout').values({ name: body.name, position }).returning(['id', 'name']).executeTakeFirstOrThrow()
			if (body.copyFrom) {
				const source = await layoutRows({ layoutId: body.copyFrom })
				if (!source.length && !(await trx.selectFrom('pnl_layout').select('id').where('id', '=', body.copyFrom).executeTakeFirst())) notFound()
				// Copies get new ids: give them fresh keys, keeping references between them.
				await saveRows(trx, layout.id, source.map(toInput).map(r => ({ ...r, key: `copy-${r.key}`, sumRowKeys: r.sumRowKeys.map(k => `copy-${k}`), numeratorKey: r.numeratorKey && `copy-${r.numeratorKey}`, denominatorKey: r.denominatorKey && `copy-${r.denominatorKey}` })))
			}
			return layout
		})
		return c.json(created, 201)
	})

	.patch('/:id', async c => {
		const body = z.object({ name }).parse(await c.req.json())
		const row = await db.updateTable('pnl_layout').set(body).where('id', '=', id.parse(c.req.param('id'))).returning(['id', 'name']).executeTakeFirst()
		return row ? c.json(row) : notFound()
	})

	.delete('/:id', async c => {
		const layoutId = id.parse(c.req.param('id'))
		if ((await listLayouts()).length <= 1) throw new HTTPException(400, { message: 'Keep at least one layout' })
		const result = await db.deleteFrom('pnl_layout').where('id', '=', layoutId).executeTakeFirst()
		return result.numDeletedRows ? c.body(null, 204) : notFound()
	})

	.put('/:id/rows', async c => {
		const layoutId = id.parse(c.req.param('id'))
		const { rows } = z.object({ rows: rowsInput }).parse(await c.req.json())
		await db.transaction().execute(async trx => {
			if (!(await trx.selectFrom('pnl_layout').select('id').where('id', '=', layoutId).executeTakeFirst())) notFound()
			await saveRows(trx, layoutId, rows)
		})
		return c.json({ rows: await layoutRows({ layoutId }) })
	})

	// Totals for unsaved rows over a year (or all time), and how many transactions no line, or several, include.
	.post('/preview', async c => {
		const body = z.object({ rows: rowsInput, year: z.number().int().min(2000).max(2100).nullable().default(null) }).parse(await c.req.json())
		const rows = toLayoutRows(body.rows)
		const [aggregates, names, years] = await Promise.all([
			loadAggregates(body.year ? `${body.year}-01-01` : undefined, body.year ? `${body.year}-12-31` : undefined),
			pnlNames(),
			db
				.selectFrom('transaction')
				.select(sql<number>`extract(year from date)::int`.as('year'))
				.where('status', '=', 'posted')
				.distinct()
				.orderBy('year', 'desc')
				.execute(),
		])
		const totals = rowTotals(rows, aggregates, names)
		return c.json({
			totals: Object.fromEntries(body.rows.map((r, i) => [r.key, totals.get(rows[i]!.id) ?? null])),
			coverage: layoutCoverage(rows, aggregates),
			availableYears: years.map(y => y.year),
		})
	})
