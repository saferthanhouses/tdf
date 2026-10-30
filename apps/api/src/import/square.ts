// Square sales exports. Both are summaries over a date range, not per sale:
//   Category sales - header row, then one row per item category: Category, Items Sold, Gross Sales, Items Refunded,
//                    Refunds, Discounts & Comps, Net Sales, Taxes
//   Sales summary  - a title, then label/value rows: Gross sales, Net sales, Taxes, Card, Cash, Fees, Net total, …
// Amounts are in cents; money out (fees) is negative as Square prints it, e.g. "($147.51)".
import { parse } from 'csv-parse/sync'
import { parseAmount } from './normalizers.js'

export interface SquareCategorySales {
	category: string
	itemsSold: number
	netCents: number
	taxCents: number
}

export interface SquareSalesSummary {
	grossCents: number
	netCents: number
	taxCents: number
	cardCents: number
	cashCents: number
	feesCents: number // negative
	netTotalCents: number
}

export type SquareFile = { kind: 'categories'; rows: SquareCategorySales[] } | { kind: 'summary'; summary: SquareSalesSummary }

const cents = (value: string) => Math.round(parseAmount(value) * 100)
const readRows = (csv: string): string[][] =>
	(parse(csv, { bom: true, relax_column_count: true, skip_empty_lines: true }) as string[][]).map(r => r.map(c => c.trim()))

export function parseSquareCategorySales(csv: string): SquareCategorySales[] {
	const [header, ...rows] = readRows(csv)
	const col = (name: string) => {
		const i = header?.findIndex(h => h.toLowerCase() === name.toLowerCase()) ?? -1
		if (i < 0) throw new Error(`Category sales file has no "${name}" column`)
		return i
	}
	const [category, itemsSold, net, tax] = [col('Category'), col('Items Sold'), col('Net Sales'), col('Taxes')]
	return rows
		.filter(r => r[category])
		.map(r => ({
			category: r[category]!,
			itemsSold: Number(r[itemsSold] || 0),
			netCents: cents(r[net] ?? ''),
			taxCents: r[tax] ? cents(r[tax]) : 0,
		}))
}

export function parseSquareSalesSummary(csv: string): SquareSalesSummary {
	// Labels are matched case-insensitively; the first occurrence wins ("Fees" appears before its breakdown).
	const values = new Map<string, string>()
	for (const [label, value] of readRows(csv)) {
		const key = label?.toLowerCase()
		if (key && value && !values.has(key)) values.set(key, value)
	}
	const get = (label: string, required = true) => {
		const v = values.get(label)
		if (v === undefined) {
			if (required) throw new Error(`Sales summary has no "${label}" row`)
			return 0
		}
		return cents(v)
	}
	return {
		grossCents: get('gross sales'),
		netCents: get('net sales'),
		taxCents: get('taxes', false),
		cardCents: get('card', false),
		cashCents: get('cash', false),
		feesCents: -Math.abs(get('fees', false)),
		netTotalCents: get('net total'),
	}
}

// Tells the two exports apart by content, so they can be uploaded together in either order.
export function parseSquareFile(csv: string): SquareFile {
	const firstLine = csv.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? ''
	if (/^"?category"?,/i.test(firstLine)) return { kind: 'categories', rows: parseSquareCategorySales(csv) }
	if (/sales summary/i.test(firstLine)) return { kind: 'summary', summary: parseSquareSalesSummary(csv) }
	throw new Error('Not a Square category sales or sales summary export')
}

// Square names exports like "category-sales-2026-05-01-2026-05-31.csv".
export function squareRangeFromFilename(name: string): { from: string; to: string } | null {
	const m = /(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})/.exec(name)
	return m ? { from: m[1]!, to: m[2]! } : null
}
