import { Hono } from 'hono'
import { sql } from 'kysely'
import { z } from 'zod'
import { db } from '@tdf-mono/db-client'
import { buildPnl, pnlColumns, type PnlAggregate } from '../reports/pnl.js'

const pnlQuery = z.object({
	period: z.enum(['month', 'year']).default('month'),
	year: z.coerce.number().int().min(2000).max(2100).optional(),
})

export const reports = new Hono().get('/pnl', async c => {
	const q = pnlQuery.parse(c.req.query())

	const years = (
		await db
			.selectFrom('transaction')
			.select(sql<number>`extract(year from date)::int`.as('year'))
			.where('status', '=', 'posted')
			.distinct()
			.execute()
	).map(r => r.year)
	const year = q.period === 'month' ? (q.year ?? Math.max(...years, new Date().getFullYear())) : null

	const periodExpr = q.period === 'month' ? sql<string>`to_char(t.date, 'YYYY-MM')` : sql<string>`to_char(t.date, 'YYYY')`
	let query = db
		.selectFrom('transaction as t')
		.innerJoin('transaction_type as tt', 'tt.id', 't.transaction_type_id')
		.leftJoin('management_category as mc', 'mc.id', 't.management_category_id')
		.select([
			periodExpr.as('period'),
			'tt.pnl_role as role',
			'tt.name as typeName',
			'mc.id as categoryId',
			'mc.name as categoryName',
			'mc.group as group',
			sql<string>`sum(t.amount)`.as('amount'),
		])
		.where('t.status', '=', 'posted')
		.groupBy(['period', 'tt.pnl_role', 'tt.name', 'mc.id', 'mc.name', 'mc.group'])
	if (year !== null) query = query.where('t.date', '>=', `${year}-01-01`).where('t.date', '<=', `${year}-12-31`)

	const aggregates: PnlAggregate[] = (await query.execute()).map(r => ({
		period: r.period,
		role: r.role,
		typeName: r.typeName,
		categoryId: r.categoryId,
		categoryName: r.categoryName,
		group: r.group,
		cents: Math.round(Number(r.amount) * 100),
	}))

	const report = buildPnl(aggregates, { period: q.period, year, columns: pnlColumns(q.period, year, years) })
	return c.json({ ...report, availableYears: years.sort((a, b) => b - a) })
})
