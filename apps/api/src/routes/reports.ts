import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { sql } from 'kysely'
import { z } from 'zod'
import { db } from '@tdf-mono/db-client'
import { buildPnl, pnlColumns } from '../reports/pnl.js'
import { layoutRows, listLayouts, loadAggregates, pnlNames } from '../reports/layouts.js'

const pnlQuery = z.object({
	layout: z.coerce.number().int().positive().optional(),
	columns: z.enum(['month', 'year', 'enterprise', 'category']).default('month'),
	// Monthly columns: which year.
	year: z.coerce.number().int().min(2000).max(2100).optional(),
	// Enterprise or category columns: a year ('2026'), a month ('2026-05') or all time ('').
	period: z
		.string()
		.regex(/^(\d{4}(-(0[1-9]|1[0-2]))?)?$/)
		.optional(),
})

const lastDay = (month: string) => {
	const [y, m] = month.split('-').map(Number) as [number, number]
	return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

export const reports = new Hono().get('/pnl', async c => {
	const q = pnlQuery.parse(c.req.query())

	const layouts = await listLayouts()
	const layout = q.layout ? layouts.find(l => l.id === q.layout) : layouts[0]
	if (!layout) throw new HTTPException(404, { message: 'P&L layout not found' })

	const years = (
		await db
			.selectFrom('transaction')
			.select(sql<number>`extract(year from date)::int`.as('year'))
			.where('status', '=', 'posted')
			.distinct()
			.execute()
	).map(r => r.year)
	const latest = Math.max(...years, new Date().getFullYear())

	// The date range the report covers.
	let year: number | null = null
	let period: string | null = null
	let from: string | undefined
	let to: string | undefined
	if (q.columns === 'month') {
		year = q.year ?? latest
		;[from, to] = [`${year}-01-01`, `${year}-12-31`]
	} else if (q.columns !== 'year') {
		period = q.period ?? String(latest)
		if (period.length === 4) [from, to] = [`${period}-01-01`, `${period}-12-31`]
		else if (period) [from, to] = [`${period}-01`, lastDay(period)]
	}

	const [rows, names, aggregates] = await Promise.all([layoutRows({ layoutId: layout.id }), pnlNames(), loadAggregates(from, to)])

	const columns = pnlColumns(q.columns, { year, years, aggregates, names })
	return c.json({
		layout,
		layouts,
		columnsBy: q.columns,
		year,
		period,
		availableYears: years.sort((a, b) => b - a),
		columns,
		rows: buildPnl(rows, aggregates, { columnsBy: q.columns, columns, names }),
	})
})
