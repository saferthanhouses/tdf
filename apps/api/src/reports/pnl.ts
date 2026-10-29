// Profit and loss, built from posted transactions summed per period, transaction type and category.
//
// Transaction types' pnl_role decides where money goes:
//   operating - into a section by the category's group: income -> Revenue, direct_production -> Direct costs,
//               selling -> Selling costs, everything else (overhead, capital, non_operating) -> Farm overhead
//   capex     - Capital expenditure, below operating profit
//   other     - Other cash movements (not part of profit), by transaction type
// Amounts are signed (money out is negative) and handled in cents.
import type { ManagementCategoryGroup, PnlRole } from '@tdf-mono/db-client'

export type PnlPeriod = 'month' | 'year'

export interface PnlAggregate {
	period: string // 'YYYY-MM' or 'YYYY'
	role: PnlRole
	typeName: string
	categoryId: number | null
	categoryName: string | null
	group: ManagementCategoryGroup | null
	cents: number
}

export interface PnlLine {
	label: string
	values: number[] // cents, one per column
	total: number
}

export interface PnlPercentLine {
	label: string
	values: (number | null)[] // percent, null when there's no revenue
	total: number | null
}

export interface PnlSection {
	title: string
	lines: PnlLine[]
	total: PnlLine
}

export interface PnlReport {
	period: PnlPeriod
	year: number | null
	columns: { key: string; label: string }[]
	revenue: PnlSection
	directCosts: PnlSection
	grossMargin: PnlLine
	grossMarginPct: PnlPercentLine
	sellingCosts: PnlSection
	overhead: PnlSection
	operatingProfit: PnlLine
	profitMarginPct: PnlPercentLine
	capex: PnlSection
	otherCashMovements: PnlSection
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function pnlColumns(period: PnlPeriod, year: number | null, years: number[]) {
	if (period === 'month') {
		if (year === null) throw new Error('A monthly P&L needs a year')
		return MONTHS.map((label, i) => ({ key: `${year}-${String(i + 1).padStart(2, '0')}`, label }))
	}
	return [...years].sort((a, b) => a - b).map(y => ({ key: String(y), label: String(y) }))
}

type SectionKey = 'revenue' | 'directCosts' | 'sellingCosts' | 'overhead'

function sectionFor(group: ManagementCategoryGroup | null): SectionKey {
	switch (group) {
		case 'income':
			return 'revenue'
		case 'direct_production':
			return 'directCosts'
		case 'selling':
			return 'sellingCosts'
		default:
			return 'overhead'
	}
}

const sumLine = (label: string, lines: PnlLine[], width: number): PnlLine => {
	const values = Array.from({ length: width }, (_, i) => lines.reduce((s, l) => s + (l.values[i] ?? 0), 0))
	return { label, values, total: values.reduce((a, b) => a + b, 0) }
}

const percent = (label: string, part: PnlLine, revenue: PnlLine): PnlPercentLine => {
	const pct = (p: number, r: number) => (r > 0 ? Math.round((p / r) * 10000) / 100 : null)
	return { label, values: part.values.map((p, i) => pct(p, revenue.values[i] ?? 0)), total: pct(part.total, revenue.total) }
}

export function buildPnl(
	aggregates: PnlAggregate[],
	opts: { period: PnlPeriod; year: number | null; columns: { key: string; label: string }[] },
): PnlReport {
	const width = opts.columns.length
	const column = new Map(opts.columns.map((c, i) => [c.key, i]))

	// Lines keyed by section and category (operating, capex) or by type name (other).
	const lines = new Map<string, { order: number; line: PnlLine }>()
	const add = (key: string, label: string, order: number, columnIndex: number, cents: number) => {
		let entry = lines.get(key)
		if (!entry) {
			entry = { order, line: { label, values: Array(width).fill(0), total: 0 } }
			lines.set(key, entry)
		}
		entry.line.values[columnIndex]! += cents
		entry.line.total += cents
	}

	for (const a of aggregates) {
		const i = column.get(a.period)
		if (i === undefined || a.cents === 0) continue
		const category = a.categoryName ?? 'Uncategorised'
		const order = a.categoryId ?? Number.MAX_SAFE_INTEGER
		if (a.role === 'operating') add(`${sectionFor(a.group)}|${category}`, category, order, i, a.cents)
		else if (a.role === 'capex') add(`capex|${category}`, category, order, i, a.cents)
		else add(`other|${a.typeName}`, a.typeName, 0, i, a.cents)
	}

	const section = (prefix: string, title: string, totalLabel: string): PnlSection => {
		const sectionLines = [...lines.entries()]
			.filter(([key]) => key.startsWith(`${prefix}|`))
			.sort(([, a], [, b]) => a.order - b.order || a.line.label.localeCompare(b.line.label))
			.map(([, e]) => e.line)
		return { title, lines: sectionLines, total: sumLine(totalLabel, sectionLines, width) }
	}

	const revenue = section('revenue', 'Revenue', 'Total revenue')
	const directCosts = section('directCosts', 'Direct costs', 'Total direct costs')
	const sellingCosts = section('sellingCosts', 'Selling costs', 'Total selling costs')
	const overhead = section('overhead', 'Farm overhead', 'Total farm overhead')
	const grossMargin = sumLine('Gross margin', [revenue.total, directCosts.total], width)
	const operatingProfit = sumLine('Operating profit', [grossMargin, sellingCosts.total, overhead.total], width)

	return {
		period: opts.period,
		year: opts.year,
		columns: opts.columns,
		revenue,
		directCosts,
		grossMargin,
		grossMarginPct: percent('Gross margin %', grossMargin, revenue.total),
		sellingCosts,
		overhead,
		operatingProfit,
		profitMarginPct: percent('Profit margin %', operatingProfit, revenue.total),
		capex: section('capex', 'Capital expenditure', 'Total capital expenditure'),
		otherCashMovements: section('other', 'Other cash movements (not in profit)', 'Net other cash movements'),
	}
}
