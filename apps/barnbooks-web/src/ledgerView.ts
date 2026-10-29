// Filtering and sorting for the ledger table. Pure functions over posted transactions; names come from the
// lookups (nameOf), so sorting by account/type/category/enterprise follows what the table shows.
import type { Transaction } from './api'

export type SortKey = 'date' | 'account' | 'vendor' | 'type' | 'category' | 'enterprise' | 'amount' | 'notes'
export type SortDir = 'asc' | 'desc'
export interface LedgerSort {
	key: SortKey
	dir: SortDir
}

// null = any; 'none' = no value set (only meaningful for enterprise).
export type IdFilter = number | 'none' | null
export interface LedgerFilters {
	account: IdFilter
	type: IdFilter
	category: IdFilter
	enterprise: IdFilter
	vendor: string
}

export const emptyFilters: LedgerFilters = { account: null, type: null, category: null, enterprise: null, vendor: '' }
export const defaultSort: LedgerSort = { key: 'date', dir: 'desc' }

type NameList = 'accounts' | 'vendors' | 'transactionTypes' | 'managementCategories' | 'enterprises'
export type NameOf = (list: NameList, id: number | null) => string

export const vendorLabel = (t: Transaction, nameOf: NameOf) => nameOf('vendors', t.vendor_id) || t.raw_description || ''

const matchesId = (filter: IdFilter, value: number | null) =>
	filter === null || (filter === 'none' ? value === null : value === filter)

export function filterLedger(rows: Transaction[], f: LedgerFilters, nameOf: NameOf): Transaction[] {
	const text = f.vendor.trim().toLowerCase()
	return rows.filter(
		t =>
			matchesId(f.account, t.account_id) &&
			matchesId(f.type, t.transaction_type_id) &&
			matchesId(f.category, t.management_category_id) &&
			matchesId(f.enterprise, t.enterprise_id) &&
			// Vendor text matches the vendor's name or the bank's description.
			(!text ||
				nameOf('vendors', t.vendor_id).toLowerCase().includes(text) ||
				(t.raw_description ?? '').toLowerCase().includes(text)),
	)
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function sortLedger(rows: Transaction[], sort: LedgerSort, nameOf: NameOf): Transaction[] {
	const text = (t: Transaction): string => {
		switch (sort.key) {
			case 'account':
				return nameOf('accounts', t.account_id)
			case 'vendor':
				return vendorLabel(t, nameOf)
			case 'type':
				return nameOf('transactionTypes', t.transaction_type_id)
			case 'category':
				return nameOf('managementCategories', t.management_category_id)
			case 'enterprise':
				return nameOf('enterprises', t.enterprise_id)
			case 'notes':
				return t.description
			default:
				return ''
		}
	}
	const dir = sort.dir === 'asc' ? 1 : -1
	const compare = (a: Transaction, b: Transaction): number => {
		if (sort.key === 'amount') return (Number(a.amount) - Number(b.amount)) * dir
		if (sort.key === 'date') return a.date.localeCompare(b.date) * dir
		const [x, y] = [text(a), text(b)]
		// Empty values go last whichever way the column is sorted.
		if (!x || !y) return x === y ? 0 : x ? -1 : 1
		return collator.compare(x, y) * dir
	}
	// Ties keep a stable, date-then-id order so the table doesn't shuffle.
	return [...rows].sort((a, b) => compare(a, b) || b.date.localeCompare(a.date) || b.id - a.id)
}

// Filters and sort round-trip through the page URL, so a reload or bookmark keeps the view.
const ID_PARAMS: [keyof Omit<LedgerFilters, 'vendor'>, string][] = [
	['account', 'account'],
	['type', 'type'],
	['category', 'category'],
	['enterprise', 'enterprise'],
]
const SORT_KEYS: SortKey[] = ['date', 'account', 'vendor', 'type', 'category', 'enterprise', 'amount', 'notes']

export function readLedgerParams(search: string) {
	const p = new URLSearchParams(search)
	const id = (v: string | null): IdFilter => (v === 'none' ? 'none' : v && /^\d+$/.test(v) ? Number(v) : null)
	const filters: LedgerFilters = { ...emptyFilters, vendor: p.get('vendor') ?? '' }
	for (const [key, param] of ID_PARAMS) filters[key] = id(p.get(param))
	const key = p.get('sort') as SortKey | null
	const sort: LedgerSort = key && SORT_KEYS.includes(key) ? { key, dir: p.get('dir') === 'asc' ? 'asc' : 'desc' } : defaultSort
	const month = /^\d{4}-\d{2}$/.test(p.get('month') ?? '') ? p.get('month')! : ''
	return { filters, sort, month }
}

export function writeLedgerParams(filters: LedgerFilters, sort: LedgerSort, month: string): string {
	const p = new URLSearchParams()
	if (month) p.set('month', month)
	for (const [key, param] of ID_PARAMS) if (filters[key] !== null) p.set(param, String(filters[key]))
	if (filters.vendor.trim()) p.set('vendor', filters.vendor)
	if (sort.key !== defaultSort.key || sort.dir !== defaultSort.dir) {
		p.set('sort', sort.key)
		p.set('dir', sort.dir)
	}
	const s = p.toString()
	return s ? `?${s}` : ''
}
