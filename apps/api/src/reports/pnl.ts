// Profit and loss, built from a saved layout (pnl_layout / pnl_row) and posted transactions summed per month,
// transaction type, category, enterprise and account.
//
// A layout is an ordered list of rows (see migrations/1793500000000_pnl_layouts.ts):
//   lines   - transactions matching the row's criteria, optionally split into a line per category, enterprise or
//             type, followed by a total line
//   total   - the sum of earlier rows; amounts are signed (money out is negative), so Revenue + Direct costs is
//             the gross margin
//   percent - one row as a percentage of another (null when the denominator isn't positive)
//   heading, spacer - layout only
// Columns are the months of a year, years, enterprises or management categories. Amounts are in cents.
import type { ManagementCategoryGroup, PnlRowKind, PnlSplit } from '@tdf-mono/db-client'

export type PnlColumnsBy = 'month' | 'year' | 'enterprise' | 'category'

// What a transaction is, as far as layout criteria are concerned.
export interface PnlFacts {
	typeId: number | null
	categoryId: number | null
	group: ManagementCategoryGroup | null
	enterpriseId: number | null
	accountId: number
}

export interface PnlAggregate extends PnlFacts {
	month: string // 'YYYY-MM'
	cents: number
}

export interface PnlLayoutRow {
	id: number
	kind: PnlRowKind
	label: string
	typeIds: number[]
	categoryIds: number[]
	categoryGroups: ManagementCategoryGroup[]
	enterpriseIds: number[]
	accountIds: number[]
	splitBy: PnlSplit
	totalLabel: string | null
	sumRowIds: number[]
	emphasis: boolean
	numeratorRowId: number | null
	denominatorRowId: number | null
}

export interface PnlNames {
	types: Map<number, string>
	categories: Map<number, string>
	enterprises: Map<number, string>
}

// The transactions behind a number: a lines row, and one of its split values ('none' = no value set).
export interface PnlLink {
	row: number
	split?: string
}

export interface PnlColumn {
	key: string
	label: string
}

// What the page draws, in order. `section` heads a split lines row; `subtotal` closes it.
export type PnlRenderedRow =
	| { kind: 'section' | 'heading'; label: string }
	| { kind: 'spacer' }
	| { kind: 'empty' }
	| { kind: 'line' | 'subtotal' | 'total'; label: string; values: number[]; total: number; link?: PnlLink; emphasis?: boolean }
	| { kind: 'percent'; label: string; values: (number | null)[]; total: number | null }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function matchesRow(row: PnlLayoutRow, t: PnlFacts): boolean {
	const has = <T>(list: T[], value: T | null) => list.length === 0 || (value !== null && list.includes(value))
	return (
		has(row.typeIds, t.typeId) &&
		has(row.categoryIds, t.categoryId) &&
		has(row.categoryGroups, t.group) &&
		has(row.enterpriseIds, t.enterpriseId) &&
		has(row.accountIds, t.accountId)
	)
}

// Which split line a transaction falls in: the id as a string, or 'none' when it has no value.
export function splitValue(split: PnlSplit, t: PnlFacts): string {
	const v = split === 'category' ? t.categoryId : split === 'enterprise' ? t.enterpriseId : split === 'type' ? t.typeId : null
	return v === null ? 'none' : String(v)
}

export function columnKey(by: PnlColumnsBy, a: PnlAggregate): string {
	if (by === 'month') return a.month
	if (by === 'year') return a.month.slice(0, 4)
	return splitValue(by, a)
}

export function pnlColumns(by: PnlColumnsBy, opts: { year?: number | null; years?: number[]; aggregates?: PnlAggregate[]; names?: PnlNames }): PnlColumn[] {
	if (by === 'month') {
		if (opts.year == null) throw new Error('A monthly P&L needs a year')
		return MONTHS.map((label, i) => ({ key: `${opts.year}-${String(i + 1).padStart(2, '0')}`, label }))
	}
	if (by === 'year') return [...(opts.years ?? [])].sort((a, b) => a - b).map(y => ({ key: String(y), label: String(y) }))
	// Enterprises or categories that have transactions in the period.
	const keys = new Set((opts.aggregates ?? []).filter(a => a.cents !== 0).map(a => columnKey(by, a)))
	return splitLines(by, [...keys], opts.names!)
}

// Labels and order for split lines (and enterprise/category columns): categories in their list order,
// enterprises and types by name; "no value" last.
function splitLines(split: PnlSplit, keys: string[], names: PnlNames): PnlColumn[] {
	const list = split === 'category' ? names.categories : split === 'enterprise' ? names.enterprises : names.types
	const none = split === 'category' ? 'Uncategorised' : split === 'enterprise' ? 'No enterprise' : 'No type'
	const label = (k: string) => (k === 'none' ? none : (list.get(Number(k)) ?? `#${k}`))
	const order = [...list.keys()]
	return keys
		.map(k => ({ key: k, label: label(k) }))
		.sort((a, b) => {
			if (a.key === 'none' || b.key === 'none') return a.key === b.key ? 0 : a.key === 'none' ? 1 : -1
			if (split === 'category') return order.indexOf(Number(a.key)) - order.indexOf(Number(b.key)) || a.label.localeCompare(b.label)
			return a.label.localeCompare(b.label)
		})
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
const percentOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : null)

export function buildPnl(rows: PnlLayoutRow[], aggregates: PnlAggregate[], opts: { columnsBy: PnlColumnsBy; columns: PnlColumn[]; names: PnlNames }): PnlRenderedRow[] {
	const width = opts.columns.length
	const column = new Map(opts.columns.map((c, i) => [c.key, i]))
	const results = new Map<number, { values: number[]; total: number }>()
	const out: PnlRenderedRow[] = []

	for (const row of rows) {
		switch (row.kind) {
			case 'spacer':
				out.push({ kind: 'spacer' })
				break
			case 'heading':
				out.push({ kind: 'heading', label: row.label })
				break
			case 'lines': {
				const values = Array<number>(width).fill(0)
				const splits = new Map<string, number[]>()
				for (const a of aggregates) {
					const i = column.get(columnKey(opts.columnsBy, a))
					if (i === undefined || a.cents === 0 || !matchesRow(row, a)) continue
					values[i]! += a.cents
					if (row.splitBy !== 'none') {
						const key = splitValue(row.splitBy, a)
						if (!splits.has(key)) splits.set(key, Array<number>(width).fill(0))
						splits.get(key)![i]! += a.cents
					}
				}
				const total = sum(values)
				results.set(row.id, { values, total })
				if (row.splitBy === 'none') {
					out.push({ kind: 'line', label: row.label, values, total, link: { row: row.id } })
					break
				}
				out.push({ kind: 'section', label: row.label })
				const lines = splitLines(row.splitBy, [...splits.keys()], opts.names)
				if (lines.length === 0) out.push({ kind: 'empty' })
				for (const l of lines) {
					const v = splits.get(l.key)!
					out.push({ kind: 'line', label: l.label, values: v, total: sum(v), link: { row: row.id, split: l.key } })
				}
				out.push({ kind: 'subtotal', label: row.totalLabel ?? `Total ${row.label.toLowerCase()}`, values, total, link: { row: row.id } })
				break
			}
			case 'total': {
				// Rows that don't exist (deleted) or come later count as zero.
				const parts = row.sumRowIds.map(id => results.get(id)).filter(r => r !== undefined)
				const values = Array.from({ length: width }, (_, i) => sum(parts.map(p => p.values[i] ?? 0)))
				const total = sum(values)
				results.set(row.id, { values, total })
				out.push({ kind: 'total', label: row.label, values, total, emphasis: row.emphasis })
				break
			}
			case 'percent': {
				const num = results.get(row.numeratorRowId ?? -1)
				const den = results.get(row.denominatorRowId ?? -1)
				out.push({
					kind: 'percent',
					label: row.label,
					values: Array.from({ length: width }, (_, i) => (num && den ? percentOf(num.values[i] ?? 0, den.values[i] ?? 0) : null)),
					total: num && den ? percentOf(num.total, den.total) : null,
				})
				break
			}
		}
	}
	return out
}
