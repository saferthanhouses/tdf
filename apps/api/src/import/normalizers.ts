// Bank-specific CSV row parsing. Each normalizer turns one raw CSV row into the
// three facts we need from the bank: when, what the bank called it, and how much.

export interface NormalizedRow {
	date: string // YYYY-MM-DD
	rawDescription: string
	amount: number // negative = money out of the account
}

export type Normalizer = (row: string[]) => NormalizedRow

// Capital One columns: Account Number, Transaction Description, Transaction Date,
// Transaction Type (Debit/Credit), Transaction Amount, Balance
const capitalOne: Normalizer = row => {
	const amount = Math.abs(parseAmount(cell(row, 4)))
	return {
		date: parseDate(cell(row, 2)),
		rawDescription: cell(row, 1),
		amount: cell(row, 3).toLowerCase() === 'debit' ? -amount : amount,
	}
}

// DNBD columns: debit in col 2, credit in col 3, date in col 5, description in col 6
const dnbd: Normalizer = row => {
	const debit = cell(row, 2)
	return {
		date: parseDate(cell(row, 5)),
		rawDescription: cell(row, 6),
		amount: debit ? -Math.abs(parseAmount(debit)) : Math.abs(parseAmount(cell(row, 3))),
	}
}

export const normalizers: Record<string, Normalizer> = {
	capital_one: capitalOne,
	dnbd,
}

function cell(row: string[], index: number): string {
	return (row[index] ?? '').trim()
}

export function parseAmount(value: string): number {
	const negative = /^\(.*\)$/.test(value) || value.startsWith('-')
	const digits = value.replace(/[$,()\s-]/g, '')
	const n = Number(digits)
	if (digits === '' || Number.isNaN(n)) throw new Error(`Invalid amount "${value}"`)
	return negative ? -n : n
}

// Accepts YYYY-MM-DD, M/D/YYYY and M/D/YY.
export function parseDate(value: string): string {
	let y: number, m: number, d: number
	const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value)
	const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value)
	if (iso) {
		;[y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
	} else if (us) {
		;[m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3])]
		if (y < 100) y += 2000
	} else {
		throw new Error(`Invalid date "${value}"`)
	}
	const date = new Date(Date.UTC(y, m - 1, d))
	if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw new Error(`Invalid date "${value}"`)
	return date.toISOString().slice(0, 10)
}
