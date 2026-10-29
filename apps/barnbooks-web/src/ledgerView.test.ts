import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Transaction } from './api'
import { emptyFilters, filterLedger, periodRange, readLedgerParams, sortLedger, writeLedgerParams, type NameOf } from './ledgerView'

const names: Record<string, Record<number, string>> = {
	accounts: { 1: 'Capital One - 9171', 2: 'DNBD - 6521' },
	vendors: { 10: 'Tractor Supply', 11: 'Lutz Feed' },
	transactionTypes: { 1: 'Expense', 2: 'Income' },
	managementCategories: { 5: 'Feed', 6: 'Market Sales', 7: 'Bedding' },
	enterprises: { 20: 'Sheep', 21: 'Beef' },
}
const nameOf: NameOf = (list, id) => (id === null ? '' : (names[list]?.[id] ?? `#${id}`))

let nextId = 1
const tx = (o: Partial<Transaction>): Transaction =>
	({
		id: nextId++,
		status: 'posted',
		date: '2026-06-01',
		account_id: 1,
		transaction_type_id: 1,
		vendor_id: null,
		management_category_id: 5,
		enterprise_id: null,
		amount: '-10.00',
		description: '',
		raw_description: null,
		import_batch_id: null,
		dedupe_hash: null,
		created_at: '2026-06-01T00:00:00Z',
		posted_at: '2026-06-01T00:00:00Z',
		...o,
	}) as Transaction

const rows = [
	tx({ date: '2026-06-03', vendor_id: 10, amount: '-45.10', enterprise_id: 20 }),
	tx({ date: '2026-06-01', account_id: 2, vendor_id: 11, amount: '-200.00', management_category_id: 7, description: 'straw' }),
	tx({ date: '2026-06-02', transaction_type_id: 2, management_category_id: 6, amount: '1200.00', raw_description: 'SQUARE INC DEPOSIT' }),
	tx({ date: '2026-06-04', raw_description: 'Pinned POS Debit TRACTOR S 65384', amount: '-9.99', enterprise_id: 21 }),
]

test('filters by account, type, category and enterprise, including "none"', () => {
	assert.equal(filterLedger(rows, { ...emptyFilters, account: 2 }, nameOf).length, 1)
	assert.equal(filterLedger(rows, { ...emptyFilters, type: 2 }, nameOf)[0]!.amount, '1200.00')
	assert.equal(filterLedger(rows, { ...emptyFilters, category: 5 }, nameOf).length, 2)
	assert.deepEqual(filterLedger(rows, { ...emptyFilters, enterprise: 'none' }, nameOf).map(t => t.amount), ['-200.00', '1200.00'])
	assert.equal(filterLedger(rows, { ...emptyFilters, enterprise: 21, category: 5 }, nameOf).length, 1)
})

test('vendor text matches vendor names and bank descriptions, ignoring case', () => {
	assert.deepEqual(filterLedger(rows, { ...emptyFilters, vendor: 'tractor' }, nameOf).map(t => t.amount), ['-45.10', '-9.99'])
	assert.equal(filterLedger(rows, { ...emptyFilters, vendor: 'square' }, nameOf).length, 1)
	assert.equal(filterLedger(rows, { ...emptyFilters, vendor: 'straw' }, nameOf).length, 0, 'notes are not searched')
})

test('sorts by date, amount and names in either direction', () => {
	const dates = (s: Transaction[]) => s.map(t => t.date)
	assert.deepEqual(dates(sortLedger(rows, { key: 'date', dir: 'desc' }, nameOf)), ['2026-06-04', '2026-06-03', '2026-06-02', '2026-06-01'])
	assert.deepEqual(sortLedger(rows, { key: 'amount', dir: 'asc' }, nameOf).map(t => t.amount), ['-200.00', '-45.10', '-9.99', '1200.00'])
	assert.deepEqual(sortLedger(rows, { key: 'category', dir: 'asc' }, nameOf).map(t => nameOf('managementCategories', t.management_category_id)), ['Bedding', 'Feed', 'Feed', 'Market Sales'])
})

test('empty values sort last in both directions', () => {
	const enterprises = (dir: 'asc' | 'desc') => sortLedger(rows, { key: 'enterprise', dir }, nameOf).map(t => nameOf('enterprises', t.enterprise_id))
	assert.deepEqual(enterprises('asc'), ['Beef', 'Sheep', '', ''])
	assert.deepEqual(enterprises('desc'), ['Sheep', 'Beef', '', ''])
})

test('vendor sort uses the vendor name, or the bank text when there is no vendor', () => {
	const labels = sortLedger(rows, { key: 'vendor', dir: 'asc' }, nameOf).map(t => nameOf('vendors', t.vendor_id) || t.raw_description)
	assert.deepEqual(labels, ['Lutz Feed', 'Pinned POS Debit TRACTOR S 65384', 'SQUARE INC DEPOSIT', 'Tractor Supply'])
})

test('filters and sort round-trip through the URL; defaults leave it clean', () => {
	assert.equal(writeLedgerParams(emptyFilters, { key: 'date', dir: 'desc' }, ''), '')
	const url = writeLedgerParams({ ...emptyFilters, account: 2, enterprise: 'none', role: 'capex', vendor: 'lutz' }, { key: 'amount', dir: 'asc' }, '2026-06')
	const back = readLedgerParams(url)
	assert.deepEqual(back.filters, { ...emptyFilters, account: 2, enterprise: 'none', role: 'capex', vendor: 'lutz' })
	assert.deepEqual(back.sort, { key: 'amount', dir: 'asc' })
	assert.equal(back.period, '2026-06')
	assert.equal(readLedgerParams('?period=2025').period, '2025')
	assert.equal(readLedgerParams('?period=2025-13').period, '')
	assert.equal(readLedgerParams('?role=bogus').filters.role, null)
	assert.deepEqual(readLedgerParams('?sort=bogus&account=abc&period=June').sort, { key: 'date', dir: 'desc' })
	assert.equal(readLedgerParams('?account=abc').filters.account, null)
})

test('the P&L role filter uses each type\'s role', () => {
	const roleOf = (typeId: number | null) => (typeId === 2 ? 'operating' : typeId === 3 ? 'capex' : typeId === 1 ? 'operating' : undefined)
	const withCapex = [...rows, tx({ transaction_type_id: 3, management_category_id: 5, amount: '-5000.00' })]
	assert.equal(filterLedger(withCapex, { ...emptyFilters, category: 5 }, nameOf, roleOf).length, 3)
	assert.deepEqual(filterLedger(withCapex, { ...emptyFilters, category: 5, role: 'operating' }, nameOf, roleOf).map(t => t.amount), ['-45.10', '-9.99'])
	assert.deepEqual(filterLedger(withCapex, { ...emptyFilters, role: 'capex' }, nameOf, roleOf).map(t => t.amount), ['-5000.00'])
})

test('periods: a whole year, a month (including February), or all time', () => {
	assert.deepEqual(periodRange('2025'), { from: '2025-01-01', to: '2025-12-31' })
	assert.deepEqual(periodRange('2024-02'), { from: '2024-02-01', to: '2024-02-29' })
	assert.deepEqual(periodRange('2026-06'), { from: '2026-06-01', to: '2026-06-30' })
	assert.deepEqual(periodRange(''), {})
})

