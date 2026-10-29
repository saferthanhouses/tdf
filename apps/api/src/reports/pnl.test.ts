import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPnl, pnlColumns, type PnlAggregate } from './pnl.js'

const agg = (period: string, role: PnlAggregate['role'], typeName: string, category: [number, string, PnlAggregate['group']] | null, cents: number): PnlAggregate => ({
	period,
	role,
	typeName,
	categoryId: category?.[0] ?? null,
	categoryName: category?.[1] ?? null,
	group: category?.[2] ?? null,
	cents,
})

const MARKET: [number, string, 'income'] = [47, 'Market Sales', 'income']
const FEED: [number, string, 'direct_production'] = [1, 'Feed', 'direct_production']
const PROCESSING: [number, string, 'direct_production'] = [3, 'Processing', 'direct_production']
const FEES: [number, string, 'selling'] = [10, 'Merchant / card processing fees', 'selling']
const FUEL: [number, string, 'overhead'] = [15, 'Fuel', 'overhead']
const EQUIPMENT: [number, string, 'capital'] = [31, 'Equipment purchase', 'capital']
const VEHICLE: [number, string, 'capital'] = [36, 'Vehicle purchase', 'capital']

const columns = pnlColumns('month', 2026, [])

const report = buildPnl(
	[
		agg('2026-06', 'operating', 'Income', MARKET, 1095334),
		agg('2026-07', 'operating', 'Income', MARKET, 1170994),
		agg('2026-06', 'operating', 'Expense', PROCESSING, -28000),
		agg('2026-06', 'operating', 'Expense', FEED, -152109),
		agg('2026-07', 'operating', 'Expense', FEED, -133001),
		agg('2026-06', 'operating', 'Income', FEED, 1000), // a refund reduces the cost
		agg('2026-06', 'operating', 'Expense', FEES, -29633),
		agg('2026-06', 'operating', 'Expense', FUEL, -21941),
		agg('2026-07', 'operating', 'Expense', EQUIPMENT, -3199), // small tools typed Expense: overhead
		agg('2026-08', 'capex', 'Asset Purchase', EQUIPMENT, -440000),
		agg('2026-06', 'capex', 'Asset Purchase', VEHICLE, -105996),
		agg('2026-06', 'other', 'Loan Principal', VEHICLE, -28917),
		agg('2026-06', 'other', 'Owner Contribution', [99, 'Owner funds', 'non_operating'], 500000),
		agg('2025-12', 'operating', 'Expense', FEED, -99999), // outside the year: ignored
		agg('2026-09', 'operating', 'Expense', FUEL, 0), // zero: no line
	],
	{ period: 'month', year: 2026, columns },
)

test('monthly columns are the 12 months of the year', () => {
	assert.equal(columns.length, 12)
	assert.deepEqual(columns[0], { key: '2026-01', label: 'Jan' })
	assert.deepEqual(columns[11], { key: '2026-12', label: 'Dec' })
	assert.deepEqual(pnlColumns('year', null, [2026, 2025]).map(c => c.key), ['2025', '2026'])
})

test('operating transactions land in the section of their category group, ordered by category', () => {
	assert.deepEqual(report.revenue.lines.map(l => l.label), ['Market Sales'])
	assert.deepEqual(report.directCosts.lines.map(l => l.label), ['Feed', 'Processing'])
	assert.deepEqual(report.sellingCosts.lines.map(l => l.label), ['Merchant / card processing fees'])
	assert.deepEqual(report.overhead.lines.map(l => l.label), ['Fuel', 'Equipment purchase'])
})

test('values are per column, and refunds net against costs', () => {
	const feed = report.directCosts.lines[0]!
	assert.equal(feed.values[5], -152109 + 1000)
	assert.equal(feed.values[6], -133001)
	assert.equal(feed.total, -152109 + 1000 - 133001)
	assert.equal(report.revenue.total.values[5], 1095334)
})

test('gross margin, operating profit and margins follow the sheet', () => {
	const june = 5
	const revenue = 1095334
	const direct = -152109 + 1000 - 28000
	assert.equal(report.grossMargin.values[june], revenue + direct)
	assert.equal(report.operatingProfit.values[june], revenue + direct - 29633 - 21941)
	assert.equal(report.grossMarginPct.values[june], Math.round(((revenue + direct) / revenue) * 10000) / 100)
	assert.equal(report.profitMarginPct.values[0], null, 'no revenue in January: no margin')
})

test('capex is Asset Purchase transactions only, and outside operating profit', () => {
	assert.deepEqual(report.capex.lines.map(l => l.label), ['Equipment purchase', 'Vehicle purchase'])
	assert.equal(report.capex.total.total, -440000 - 105996)
	assert.equal(report.capex.total.values[7], -440000)
	const operatingTotal = report.operatingProfit.total
	assert.equal(operatingTotal, 1095334 + 1170994 + (-152109 + 1000 - 133001 - 28000) - 29633 - 21941 - 3199)
})

test('other transaction types are listed by type and kept out of profit', () => {
	assert.deepEqual(report.otherCashMovements.lines.map(l => [l.label, l.total]), [
		['Loan Principal', -28917],
		['Owner Contribution', 500000],
	])
	assert.equal(report.otherCashMovements.total.total, 500000 - 28917)
})

test('periods outside the columns and zero amounts are ignored', () => {
	assert.equal(report.overhead.lines.find(l => l.label === 'Fuel')!.total, -21941)
	assert.ok(report.directCosts.total.values.every((v, i) => i === 5 || i === 6 || v === 0))
})
