import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, groupLabels, type ManagementCategoryGroup, type Transaction } from '../api'
import { useLookups } from '../lookups'
import { formatMoney } from '../format'
import {
	emptyFilters,
	filterLedger,
	readLedgerParams,
	sortLedger,
	vendorLabel,
	writeLedgerParams,
	type IdFilter,
	type LedgerFilters,
	type LedgerSort,
	type SortKey,
} from '../ledgerView'

function monthRange(month: string) {
	const [y, m] = month.split('-').map(Number) as [number, number]
	const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
	return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

const COLUMNS: { key: SortKey; label: string; num?: boolean }[] = [
	{ key: 'date', label: 'Date' },
	{ key: 'account', label: 'Account' },
	{ key: 'vendor', label: 'Vendor' },
	{ key: 'type', label: 'Type' },
	{ key: 'category', label: 'Management category' },
	{ key: 'enterprise', label: 'Enterprise' },
	{ key: 'amount', label: 'Amount', num: true },
	{ key: 'notes', label: 'Notes' },
]

export function LedgerPage() {
	const { lookups, nameOf } = useLookups()
	const initial = useMemo(() => readLedgerParams(window.location.search), [])
	// All time by default: posting a backlog of older drafts shouldn't land outside the visible month.
	const [month, setMonth] = useState(initial.month)
	const [filters, setFilters] = useState<LedgerFilters>(initial.filters)
	const [sort, setSort] = useState<LedgerSort>(initial.sort)
	const [rows, setRows] = useState<Transaction[] | null>(null)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(async () => {
		try {
			setRows(await api.transactions('posted', month ? monthRange(month) : {}))
			setError(null)
		} catch (e) {
			setError((e as Error).message)
		}
	}, [month])

	useEffect(() => {
		void load()
	}, [load])

	// Pick up transactions posted from another window when this one regains focus.
	useEffect(() => {
		const refresh = () => {
			if (document.visibilityState === 'visible') void load()
		}
		window.addEventListener('focus', refresh)
		document.addEventListener('visibilitychange', refresh)
		return () => {
			window.removeEventListener('focus', refresh)
			document.removeEventListener('visibilitychange', refresh)
		}
	}, [load])

	// Keep the view in the URL so a reload or bookmark restores it; clear it when leaving the tab.
	useEffect(() => {
		const { pathname, hash } = window.location
		window.history.replaceState(null, '', pathname + writeLedgerParams(filters, sort, month) + hash)
	}, [filters, sort, month])
	useEffect(() => () => window.history.replaceState(null, '', window.location.pathname + window.location.hash), [])

	const shown = useMemo(
		() => (rows ? sortLedger(filterLedger(rows, filters, nameOf), sort, nameOf) : []),
		[rows, filters, sort, nameOf],
	)

	const unpost = async (id: number) => {
		try {
			await api.unpostTransaction(id)
			await load()
		} catch (e) {
			setError((e as Error).message)
		}
	}

	const setFilter = <K extends keyof LedgerFilters>(key: K, value: LedgerFilters[K]) => setFilters(f => ({ ...f, [key]: value }))
	const filtering = JSON.stringify(filters) !== JSON.stringify(emptyFilters)
	const toggleSort = (key: SortKey) =>
		setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' || key === 'amount' ? 'desc' : 'asc' }))
	const total = shown.reduce((sum, r) => sum + Math.round(Number(r.amount) * 100), 0)

	return (
		<section>
			<div className="toolbar">
				<h2>Ledger</h2>
				<div className="spacer" />
				<label>
					Month <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
				</label>
				<button onClick={() => setMonth('')} disabled={!month}>
					All time
				</button>
			</div>

			<div className="filters" role="search" aria-label="Filter the ledger">
				<input
					type="search"
					placeholder="Vendor or bank text"
					aria-label="Vendor or bank text"
					value={filters.vendor}
					onChange={e => setFilter('vendor', e.target.value)}
				/>
				<FilterSelect label="Account" plural="accounts" items={lookups.accounts} value={filters.account} onChange={v => setFilter('account', v)} />
				<FilterSelect label="Type" plural="types" items={lookups.transactionTypes} value={filters.type} onChange={v => setFilter('type', v)} />
				<FilterSelect
					label="Category"
					plural="categories"
					items={lookups.managementCategories}
					grouped
					value={filters.category}
					onChange={v => setFilter('category', v)}
				/>
				<FilterSelect
					label="Enterprise"
					plural="enterprises"
					items={lookups.enterprises}
					allowNone
					value={filters.enterprise}
					onChange={v => setFilter('enterprise', v)}
				/>
				{filtering && (
					<button className="link" onClick={() => setFilters(emptyFilters)}>
						Clear filters
					</button>
				)}
			</div>

			{error && <p className="error">{error}</p>}
			{!rows ? (
				<p className="muted">Loading…</p>
			) : rows.length === 0 ? (
				<p className="muted">No posted transactions{month ? ' in this month' : ''}.</p>
			) : (
				<div className="table-wrap">
					<table className="ledger-table">
						<thead>
							<tr>
								{COLUMNS.map(c => {
									const active = sort.key === c.key
									return (
										<th
											key={c.key}
											className={c.num ? 'num' : undefined}
											aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
										>
											<button className={`sort${active ? ' active' : ''}`} onClick={() => toggleSort(c.key)}>
												{c.label}
												<span className="sort-arrow" aria-hidden="true">
													{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
												</span>
											</button>
										</th>
									)
								})}
								<th />
							</tr>
						</thead>
						<tbody>
							{shown.length === 0 ? (
								<tr>
									<td colSpan={COLUMNS.length + 1} className="muted">
										No transactions match these filters.
									</td>
								</tr>
							) : (
								shown.map(t => (
									<tr key={t.id}>
										<td>{t.date}</td>
										<td>{nameOf('accounts', t.account_id)}</td>
										<td title={t.raw_description ?? undefined}>{vendorLabel(t, nameOf)}</td>
										<td>{nameOf('transactionTypes', t.transaction_type_id)}</td>
										<td>{nameOf('managementCategories', t.management_category_id)}</td>
										<td>{nameOf('enterprises', t.enterprise_id)}</td>
										<td className={`num ${Number(t.amount) < 0 ? 'out' : 'in'}`}>{formatMoney(t.amount)}</td>
										<td>{t.description}</td>
										<td className="row-actions">
											<button className="link" title="Move back to drafts to edit" onClick={() => unpost(t.id)}>
												Unpost
											</button>
										</td>
									</tr>
								))
							)}
						</tbody>
						<tfoot>
							<tr>
								<td colSpan={6}>
									Net{' '}
									<span className="muted">
										· {shown.length === rows.length ? `${rows.length} transactions` : `${shown.length} of ${rows.length} transactions`}
									</span>
								</td>
								<td className="num">{formatMoney(total / 100)}</td>
								<td colSpan={2} />
							</tr>
						</tfoot>
					</table>
				</div>
			)}
		</section>
	)
}

interface FilterOption {
	id: number
	name: string
	archived?: boolean
	group?: ManagementCategoryGroup
}

// A filter dropdown: "All", optionally "None", then every entry (archived ones too, since old transactions use them).
function FilterSelect({
	label,
	plural,
	items,
	value,
	onChange,
	grouped = false,
	allowNone = false,
}: {
	label: string
	plural: string
	items: FilterOption[]
	value: IdFilter
	onChange: (v: IdFilter) => void
	grouped?: boolean
	allowNone?: boolean
}) {
	const options = (list: FilterOption[]) =>
		list.map(i => (
			<option key={i.id} value={i.id}>
				{i.name}
				{i.archived ? ' (archived)' : ''}
			</option>
		))
	return (
		<select
			aria-label={label}
			className={value !== null ? 'active' : undefined}
			value={value === null ? '' : String(value)}
			onChange={e => {
				const v = e.target.value
				onChange(v === '' ? null : v === 'none' ? 'none' : Number(v))
			}}
		>
			<option value="">All {plural}</option>
			{allowNone && <option value="none">No {label.toLowerCase()}</option>}
			{grouped
				? (Object.keys(groupLabels) as ManagementCategoryGroup[]).map(g => {
						const inGroup = items.filter(i => i.group === g)
						return inGroup.length ? (
							<optgroup key={g} label={groupLabels[g]}>
								{options(inGroup)}
							</optgroup>
						) : null
					})
				: options(items)}
		</select>
	)
}
