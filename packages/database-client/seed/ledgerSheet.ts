// Parsing for Transaction Ledger exports from the old Google Sheet (CSV or tab-separated).
import { parse } from 'csv-parse/sync'

const COLUMNS = ['date', 'type', 'account', 'vendor', 'category', 'enterprise', 'amount', 'description'] as const
type Column = (typeof COLUMNS)[number]

export type LedgerSheetRow = { line: number; repaired: boolean } & Record<Column, string>

// Header names (lowercased) for each column. Columns are found by name, so their order doesn't matter.
const HEADER_NAMES: Record<Column, string[]> = {
	date: ['date'],
	type: ['transaction type', 'type'],
	account: ['account'],
	vendor: ['vendor', 'vendor / customer'],
	category: ['management category', 'category'],
	enterprise: ['enterprise', 'enterprise category'],
	amount: ['amount'],
	description: ['description', 'notes'],
}
const REQUIRED: Column[] = ['date', 'type', 'account', 'vendor', 'category', 'enterprise', 'amount']

// The CSV export was converted from tab-separated text, so values containing commas were split into extra
// columns ('LOWE'S #1967 ONEONTA, NY US', 'Meat Birds, Layers'). The split-off piece starts with a space,
// so it is glued back onto the value before it. Tab-separated files never need this.
function repair(cells: string[], width: number, line: number): string[] {
	const out = [...cells]
	while (out.length > width) {
		const i = out.findIndex((c, j) => j > 0 && /^\s/.test(c))
		if (i === -1) throw new Error(`Line ${line}: ${out.length} columns and no split value to rejoin`)
		out.splice(i - 1, 2, `${out[i - 1]},${out[i]}`)
	}
	return out
}

export function parseLedgerSheet(text: string): LedgerSheetRow[] {
	const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? ''
	const delimiter = firstLine.includes('\t') ? '\t' : ','
	const records = parse(text, {
		bom: true,
		delimiter,
		relax_column_count: true,
		skip_empty_lines: true,
		info: true,
	}) as unknown as { record: string[]; info: { lines: number } }[]

	const header = (records[0]?.record ?? []).map(h => h.trim().toLowerCase())
	const index = Object.fromEntries(
		COLUMNS.map(c => [c, header.findIndex(h => HEADER_NAMES[c].includes(h))]),
	) as Record<Column, number>
	const missing = REQUIRED.filter(c => index[c] === -1)
	if (missing.length) {
		throw new Error(`Header row is missing: ${missing.join(', ')} (found: ${header.join(' | ') || 'nothing'})`)
	}

	return records
		.slice(1)
		.filter(({ record }) => record.some(c => c.trim() !== ''))
		.map(({ record, info }) => {
			const cells = delimiter === ',' ? repair(record, header.length, info.lines) : record
			const row = Object.fromEntries(COLUMNS.map(c => [c, index[c] === -1 ? '' : (cells[index[c]] ?? '').trim()])) as Record<Column, string>
			return { ...row, line: info.lines, repaired: cells.length !== record.length }
		})
}

// MM/DD/YYYY or M/D/YYYY -> YYYY-MM-DD
export function isoDate(value: string, line: number): string {
	const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value)
	if (!m) throw new Error(`Line ${line}: invalid date "${value}"`)
	return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`
}

// Values that are a bank's description rather than a vendor name (Capital One and DNBD wording),
// e.g. 'Debit Card Purchase - ...', 'Pinned POS Debit 10/04 NY STAMFORD SUNOCO ...',
// 'ATM Withdrawal ...', 'Recur Payment ...', 'POS Return ...', '628554 INTERNET TRANSFER FROM ...', 'NSF PAID ITEM(S) FEE'.
const BANK_TEXT = [
	/^(debit card purchase|digital card purchase|signature pos|pinned pos debit|pos debit|pos return|recur payment|check #|withdrawal|deposit|zelle|atm |venmo cashout)/i,
	/^check$/i,
	/^\d+ internet transfer /i,
	/ - (deposit from|withdrawal (to|from)) /i,
	/^(overdrawn account|nsf paid item|atm service charge)/i,
	/^cashier's check payment/i,
	/acct ?verify/i,
]
export const isBankText = (s: string) => BANK_TEXT.some(re => re.test(s))

// 'Meat Birds / Ducks' or 'Meat Birds, Layers' -> 'Meat Birds'.
export const firstEnterprise = (s: string) => s.split(/\s*,\s*|\s+\/\s+/)[0]!.trim()
