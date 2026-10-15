import { useCallback, useEffect, useState } from 'react'
import { api, type Transaction } from '../api'
import { useLookups } from '../lookups'
import { formatMoney, localToday } from '../format'

const currentMonth = () => localToday().slice(0, 7)

function monthRange(month: string) {
	const [y, m] = month.split('-').map(Number) as [number, number]
	const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
	return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

export function LedgerPage() {
	const { nameOf } = useLookups()
	const [month, setMonth] = useState(currentMonth)
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

	const unpost = async (id: number) => {
		try {
			await api.unpostTransaction(id)
			await load()
		} catch (e) {
			setError((e as Error).message)
		}
	}

	const total = rows?.reduce((sum, r) => sum + Math.round(Number(r.amount) * 100), 0) ?? 0

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
			{error && <p className="error">{error}</p>}
			{!rows ? (
				<p className="muted">Loading…</p>
			) : rows.length === 0 ? (
				<p className="muted">No posted transactions{month ? ' this month' : ''}.</p>
			) : (
				<div className="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Date</th>
								<th>Account</th>
								<th>Vendor</th>
								<th>Type</th>
								<th>Management category</th>
								<th>Enterprise</th>
								<th className="num">Amount</th>
								<th>Notes</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{rows.map(t => (
								<tr key={t.id}>
									<td>{t.date}</td>
									<td>{nameOf('accounts', t.account_id)}</td>
									<td title={t.raw_description ?? undefined}>{nameOf('vendors', t.vendor_id) || t.raw_description}</td>
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
							))}
						</tbody>
						<tfoot>
							<tr>
								<td colSpan={6}>Net</td>
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
