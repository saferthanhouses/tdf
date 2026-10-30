import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ManagementCategoryGroup } from '@tdf-mono/db-client'
import { buildPnl, matchesRow, pnlColumns, type PnlAggregate, type PnlLayoutRow, type PnlLink, type PnlNames, type PnlRenderedRow } from './pnl.js'

const TYPES = { Expense: 1, Income: 2, 'Asset Purchase': 3, 'Owner Contribution': 5, 'Loan Principal': 8 } as const
type Category = [number, string, ManagementCategoryGroup]
const MARKET: Category = [47, 'Market Sales', 'income']
const FEED: Category = [1, 'Feed', 'direct_production']
const PROCESSING: Category = [3, 'Processing', 'direct_production']
const FEES: Category = [10, 'Merchant / card processing fees', 'selling']
const FUEL: Category = [15, 'Fuel', 'overhead']
const EQUIPMENT: Category = [31, 'Equipment purchase', 'capital']
const VEHICLE: Category = [36, 'Vehicle purchase', 'capital']
const OWNER: Category = [99, 'Owner funds', 'non_operating']
const BEEF = 1
const SHEEP = 14

const names: PnlNames = {
	types: new Map(Object.entries(TYPES).map(([name, id]) => [id, name])),
	categories: new Map([MARKET, FEED, PROCESSING, FEES, FUEL, EQUIPMENT, VEHICLE, OWNER].sort((a, b) => a[0] - b[0]).map(([id, name]) => [id, name])),
	enterprises: new Map([
		[BEEF, 'Beef'],
		[SHEEP, 'Sheep'],
	]),
}

const agg = (month: string, type: keyof typeof TYPES, category: Category, cents: number, enterpriseId: number | null = null): PnlAggregate => ({
	month,
	typeId: TYPES[type],
	categoryId: category[0],
	group: category[2],
	enterpriseId,
	accountId: 1,
	cents,
})

const aggregates = [
	agg('2026-06', 'Income', MARKET, 1095334, BEEF),
	agg('2026-07', 'Income', MARKET, 1170994),
	agg('2026-06', 'Expense', PROCESSING, -28000, BEEF),
	agg('2026-06', 'Expense', FEED, -152109, SHEEP),
	agg('2026-07', 'Expense', FEED, -133001),
	agg('2026-06', 'Income', FEED, 1000, SHEEP), // a refund reduces the cost
	agg('2026-06', 'Expense', FEES, -29633),
	agg('2026-06', 'Expense', FUEL, -21941),
	agg('2026-07', 'Expense', EQUIPMENT, -3199), // small tools typed Expense: overhead
	agg('2026-08', 'Asset Purchase', EQUIPMENT, -440000),
	agg('2026-06', 'Asset Purchase', VEHICLE, -105996),
	agg('2026-06', 'Loan Principal', VEHICLE, -28917),
	agg('2026-06', 'Owner Contribution', OWNER, 500000),
	agg('2025-12', 'Expense', FEED, -99999), // outside the year: ignored
	agg('2026-09', 'Expense', FUEL, 0), // zero: no line
]

// The Standard layout as seeded by the migration.
const row = (id: number, r: Partial<PnlLayoutRow> & Pick<PnlLayoutRow, 'kind'>): PnlLayoutRow => ({
	id,
	label: '',
	typeIds: [],
	categoryIds: [],
	categoryGroups: [],
	enterpriseIds: [],
	accountIds: [],
	splitBy: 'none',
	totalLabel: null,
	sumRowIds: [],
	emphasis: false,
	numeratorRowId: null,
	denominatorRowId: null,
	...r,
})
const operating = [TYPES.Expense, TYPES.Income]
const standard: PnlLayoutRow[] = [
	row(1, { kind: 'lines', label: 'Revenue', totalLabel: 'Total revenue', typeIds: operating, categoryGroups: ['income'], splitBy: 'category' }),
	row(2, { kind: 'lines', label: 'Direct costs', typeIds: operating, categoryGroups: ['direct_production'], splitBy: 'category' }),
	row(3, { kind: 'total', label: 'Gross margin', sumRowIds: [1, 2] }),
	row(4, { kind: 'percent', label: 'Gross margin %', numeratorRowId: 3, denominatorRowId: 1 }),
	row(5, { kind: 'spacer' }),
	row(6, { kind: 'lines', label: 'Selling costs', typeIds: operating, categoryGroups: ['selling'], splitBy: 'category' }),
	row(7, { kind: 'lines', label: 'Farm overhead', typeIds: operating, categoryGroups: ['overhead', 'capital', 'non_operating'], splitBy: 'category' }),
	row(8, { kind: 'total', label: 'Operating profit', sumRowIds: [3, 6, 7], emphasis: true }),
	row(9, { kind: 'percent', label: 'Profit margin %', numeratorRowId: 8, denominatorRowId: 1 }),
	row(10, { kind: 'lines', label: 'Capital expenditure', typeIds: [TYPES['Asset Purchase']], splitBy: 'category' }),
	row(11, { kind: 'lines', label: 'Other cash movements', totalLabel: 'Net other cash movements', typeIds: [TYPES['Loan Principal'], TYPES['Owner Contribution']], splitBy: 'type' }),
]

const columns = pnlColumns('month', { year: 2026 })
const report = buildPnl(standard, aggregates, { columnsBy: 'month', columns, names })

type ValueRow = Extract<PnlRenderedRow, { kind: 'line' | 'subtotal' | 'total' }>
type Found = { label: string; values: (number | null)[]; total: number | null; link?: PnlLink }

// The rows of one lines section: its split lines, then its total.
function section(rows: PnlRenderedRow[], title: string) {
	const start = rows.findIndex(r => r.kind === 'section' && r.label === title)
	const end = rows.findIndex((r, i) => i > start && r.kind === 'subtotal')
	const lines = rows.slice(start + 1, end).filter((r): r is ValueRow => r.kind === 'line')
	return { lines, total: rows[end] as ValueRow }
}
const find = (rows: PnlRenderedRow[], label: string) => rows.find(r => 'label' in r && r.label === label) as Found

test('columns: months of a year, years, or the enterprises with transactions (none last)', () => {
	assert.equal(columns.length, 12)
	assert.deepEqual(columns[0], { key: '2026-01', label: 'Jan' })
	assert.deepEqual(pnlColumns('year', { years: [2026, 2025] }).map(c => c.key), ['2025', '2026'])
	assert.deepEqual(pnlColumns('enterprise', { aggregates, names }).map(c => c.label), ['Beef', 'Sheep', 'No enterprise'])
})

test('lines rows split by category, in category order, with a total line', () => {
	assert.deepEqual(section(report, 'Revenue').lines.map(l => l.label), ['Market Sales'])
	assert.deepEqual(section(report, 'Direct costs').lines.map(l => l.label), ['Feed', 'Processing'])
	assert.deepEqual(section(report, 'Farm overhead').lines.map(l => l.label), ['Fuel', 'Equipment purchase'])
	assert.equal(section(report, 'Revenue').total.label, 'Total revenue')
	assert.equal(section(report, 'Direct costs').total.label, 'Total direct costs', 'default total label')
})

test('values are per column, and refunds net against costs', () => {
	const feed = section(report, 'Direct costs').lines[0]!
	assert.equal(feed.values[5], -152109 + 1000)
	assert.equal(feed.values[6], -133001)
	assert.equal(feed.total, -152109 + 1000 - 133001)
})

test('totals add rows (amounts are signed) and percents divide them', () => {
	const june = 5
	const revenue = 1095334
	const direct = -152109 + 1000 - 28000
	assert.equal(find(report, 'Gross margin').values[june], revenue + direct)
	assert.equal(find(report, 'Operating profit').values[june], revenue + direct - 29633 - 21941)
	assert.equal(find(report, 'Gross margin %').values[june], Math.round(((revenue + direct) / revenue) * 10000) / 100)
	assert.equal(find(report, 'Profit margin %').values[0], null, 'no revenue in January: no margin')
})

test('capital expenditure and other movements are their own types, outside operating profit', () => {
	assert.deepEqual(section(report, 'Capital expenditure').lines.map(l => l.label), ['Equipment purchase', 'Vehicle purchase'])
	assert.equal(section(report, 'Capital expenditure').total.total, -440000 - 105996)
	assert.equal(find(report, 'Operating profit').total, 1095334 + 1170994 + (-152109 + 1000 - 133001 - 28000) - 29633 - 21941 - 3199)
	assert.deepEqual(
		section(report, 'Other cash movements').lines.map(l => [l.label, l.total]),
		[
			['Loan Principal', -28917],
			['Owner Contribution', 500000],
		],
	)
})

test('periods outside the columns and zero amounts are ignored', () => {
	assert.equal(find(report, 'Fuel').total, -21941)
	assert.ok(section(report, 'Direct costs').total.values.every((v, i) => i === 5 || i === 6 || v === 0))
})

test('lines and their totals link to their layout row and split value', () => {
	assert.deepEqual(section(report, 'Direct costs').lines[0]!.link, { row: 2, split: '1' })
	assert.deepEqual(section(report, 'Other cash movements').lines[0]!.link, { row: 11, split: String(TYPES['Loan Principal']) })
	assert.deepEqual(section(report, 'Revenue').total.link, { row: 1 })
	assert.equal(find(report, 'Gross margin').link, undefined, 'computed totals have no single filter')
})

test('enterprise columns compare margin across product lines', () => {
	const cols = pnlColumns('enterprise', { aggregates: aggregates.filter(a => a.month.startsWith('2026')), names })
	const rows = buildPnl(standard, aggregates.filter(a => a.month.startsWith('2026')), { columnsBy: 'enterprise', columns: cols, names })
	const [beef, sheep] = [0, 1]
	assert.equal(find(rows, 'Gross margin').values[beef], 1095334 - 28000)
	assert.equal(find(rows, 'Gross margin').values[sheep], -152109 + 1000)
	assert.equal(find(rows, 'Gross margin %').values[sheep], null)
})

test('split by enterprise, and rows criteria: empty lists mean any', () => {
	const byEnterprise = [row(1, { kind: 'lines', label: 'Direct costs', categoryGroups: ['direct_production'], splitBy: 'enterprise' })]
	const rows = buildPnl(byEnterprise, aggregates, { columnsBy: 'month', columns, names })
	assert.deepEqual(section(rows, 'Direct costs').lines.map(l => [l.label, l.total]), [
		['Beef', -28000],
		['Sheep', -152109 + 1000],
		['No enterprise', -133001],
	])
	assert.equal(matchesRow(row(1, { kind: 'lines' }), aggregates[0]!), true)
	assert.equal(matchesRow(row(1, { kind: 'lines', enterpriseIds: [SHEEP] }), aggregates[0]!), false)
})

test('a total referring to a deleted row counts it as zero', () => {
	const rows = buildPnl([row(1, { kind: 'lines', label: 'Fuel', categoryIds: [FUEL[0]] }), row(2, { kind: 'total', label: 'Sum', sumRowIds: [1, 99] })], aggregates, {
		columnsBy: 'month',
		columns,
		names,
	})
	assert.equal(find(rows, 'Sum').total, -21941)
})
