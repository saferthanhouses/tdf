// Parsing for the Transaction Ledger exported from the old Google Sheet.
import { parse } from 'csv-parse/sync'

const COLUMNS = ['date', 'type', 'account', 'vendor', 'category', 'enterprise', 'amount', 'description'] as const

export type LedgerSheetRow = { line: number; repaired: boolean } & Record<(typeof COLUMNS)[number], string>

// The sheet was converted from tab-separated text, so values containing commas were split into extra columns
// ('LOWE'S #1967 ONEONTA, NY US', 'Meat Birds, Layers'). The split-off piece starts with a space, so it is
// glued back onto the value before it.
function repair(cells: string[], line: number): string[] {
	const out = [...cells]
	while (out.length > COLUMNS.length) {
		const i = out.findIndex((c, j) => j > 0 && /^\s/.test(c))
		if (i === -1) throw new Error(`Line ${line}: ${out.length} columns and no split value to rejoin`)
		out.splice(i - 1, 2, `${out[i - 1]},${out[i]}`)
	}
	return out
}

export function parseLedgerSheet(text: string): LedgerSheetRow[] {
	const records = parse(text, { bom: true, relax_column_count: true, skip_empty_lines: true, info: true }) as unknown as {
		record: string[]
		info: { lines: number }
	}[]
	return records.slice(1).map(({ record, info }) => {
		const cells = repair(record, info.lines)
		const row = Object.fromEntries(COLUMNS.map((c, i) => [c, (cells[i] ?? '').trim()])) as Record<(typeof COLUMNS)[number], string>
		return { ...row, line: info.lines, repaired: cells.length !== record.length }
	})
}

// MM/DD/YYYY -> YYYY-MM-DD
export function isoDate(value: string, line: number): string {
	const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value)
	if (!m) throw new Error(`Line ${line}: invalid date "${value}"`)
	return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`
}

// Values that are a bank's description rather than a vendor name.
export const isBankText = (s: string) =>
	/^(debit card purchase|digital card purchase|signature pos|check #|withdrawal|deposit|zelle)/i.test(s)

// 'Meat Birds / Ducks' or 'Meat Birds, Layers' -> 'Meat Birds'.
export const firstEnterprise = (s: string) => s.split(/\s*,\s*|\s+\/\s+/)[0]!.trim()
