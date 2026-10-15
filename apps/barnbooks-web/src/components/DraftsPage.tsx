import { useCallback, useEffect, useState } from 'react'
import { api, type Transaction, type TransactionEdit } from '../api'
import { LookupSelect, useLookups } from '../lookups'
import { formatMoney, localToday } from '../format'
import { ImportPanel } from './ImportPanel'
import { CommitInput } from './CommitInput'

const isComplete = (t: Transaction) => t.transaction_type_id !== null && t.management_category_id !== null

export function DraftsPage() {
	const { lookups, reload: reloadLookups } = useLookups()
	const [drafts, setDrafts] = useState<Transaction[] | null>(null)
	const [selected, setSelected] = useState<Set<number>>(new Set())
	const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)

	const load = useCallback(async () => {
		try {
			setDrafts(await api.transactions('draft'))
		} catch (e) {
			setMessage({ kind: 'error', text: (e as Error).message })
		}
	}, [])

	useEffect(() => {
		void load()
	}, [load])

	const run = async (action: () => Promise<string | void>) => {
		try {
			const text = await action()
			setMessage(text ? { kind: 'info', text } : null)
		} catch (e) {
			setMessage({ kind: 'error', text: (e as Error).message })
		}
	}

	const update = (id: number, edit: TransactionEdit) =>
		run(async () => {
			// Show the change immediately; the server response (or a reload on error) settles it.
			setDrafts(ds => ds?.map(d => (d.id === id ? { ...d, ...edit } : d)) ?? null)
			try {
				const saved = await api.updateTransaction(id, edit)
				setDrafts(ds => ds?.map(d => (d.id === id ? saved : d)) ?? null)
			} catch (e) {
				await load()
				throw e
			}
		})

	const remove = (id: number) =>
		run(async () => {
			await api.deleteTransaction(id)
			setDrafts(ds => ds?.filter(d => d.id !== id) ?? null)
			setSelected(s => new Set([...s].filter(x => x !== id)))
		})

	const post = (ids: number[]) =>
		run(async () => {
			if (!ids.length) return 'Nothing to post'
			const result = await api.postTransactions(ids)
			setSelected(new Set())
			await load()
			return result.incomplete.length
				? `Posted ${result.posted}. ${result.incomplete.length} still need a type and category.`
				: `Posted ${result.posted} transaction(s) to the ledger.`
		})

	const makeVendorRule = (t: Transaction) =>
		run(async () => {
			const pattern = window.prompt(
				'Text to match in the bank description (case-insensitive). Future imports containing it get this row’s type, category and enterprise.',
				t.raw_description ?? '',
			)
			if (!pattern?.trim()) return
			const name = window.prompt('Vendor name', pattern.trim())
			if (!name?.trim()) return
			const vendor = (await api.createLookup('vendors', {
				name: name.trim(),
				match_pattern: pattern.trim(),
				default_transaction_type_id: t.transaction_type_id,
				default_management_category_id: t.management_category_id,
				default_enterprise_id: t.enterprise_id,
			})) as { id: number }
			await api.updateTransaction(t.id, { vendor_id: vendor.id })
			const { matched } = await api.rematchDrafts()
			await Promise.all([reloadLookups(), load()])
			return `Created vendor “${name.trim()}” and matched ${matched} other draft(s).`
		})

	const addManual = () =>
		run(async () => {
			const cash = lookups.accounts.find(a => a.import_format === null) ?? lookups.accounts[0]
			if (!cash) return 'Add an account first'
			await api.createTransaction({
				date: localToday(),
				account_id: cash.id,
				amount: '0',
				description: '',
			})
			await load()
			return `Added a draft to ${cash.name} — set its amount and categories below.`
		})

	if (!drafts) return <p className="muted">Loading drafts…</p>

	const completeIds = drafts.filter(isComplete).map(d => d.id)
	const allSelected = drafts.length > 0 && selected.size === drafts.length

	return (
		<section>
			<ImportPanel
				onImported={async text => {
					await load()
					setMessage({ kind: 'info', text })
				}}
				onError={text => setMessage({ kind: 'error', text })}
			/>

			<div className="toolbar">
				<h2>
					Drafts <span className="muted">({drafts.length})</span>
				</h2>
				<div className="spacer" />
				<button onClick={addManual}>Add transaction</button>
				<button onClick={() => run(async () => `Matched ${(await api.rematchDrafts()).matched} draft(s) to vendors.`).then(load)}>
					Re-apply vendor rules
				</button>
				<button disabled={!selected.size} onClick={() => post([...selected])}>
					Post selected ({selected.size})
				</button>
				<button className="primary" disabled={!completeIds.length} onClick={() => post(completeIds)}>
					Post all complete ({completeIds.length})
				</button>
			</div>

			{message && <p className={message.kind === 'error' ? 'error' : 'notice'}>{message.text}</p>}

			{drafts.length === 0 ? (
				<p className="muted">No drafts. Import a bank CSV above to get started.</p>
			) : (
				<div className="table-wrap">
					<table>
						<thead>
							<tr>
								<th>
									<input
										type="checkbox"
										aria-label="Select all"
										checked={allSelected}
										onChange={() => setSelected(allSelected ? new Set() : new Set(drafts.map(d => d.id)))}
									/>
								</th>
								<th>Date</th>
								<th>Account</th>
								<th>Bank description</th>
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
							{drafts.map(t => (
								<DraftRow
									key={t.id}
									t={t}
									selected={selected.has(t.id)}
									onToggle={() =>
										setSelected(s => {
											const next = new Set(s)
											if (next.has(t.id)) next.delete(t.id)
											else next.add(t.id)
											return next
										})
									}
									onChange={edit => update(t.id, edit)}
									onDelete={() => remove(t.id)}
									onMakeRule={() => makeVendorRule(t)}
								/>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	)
}

function DraftRow({
	t,
	selected,
	onToggle,
	onChange,
	onDelete,
	onMakeRule,
}: {
	t: Transaction
	selected: boolean
	onToggle: () => void
	onChange: (edit: TransactionEdit) => void
	onDelete: () => void
	onMakeRule: () => void
}) {
	const { lookups } = useLookups()
	// Imported rows keep their bank date/amount/account; manual rows are fully editable.
	const manual = t.raw_description === null

	return (
		<tr className={isComplete(t) ? undefined : 'incomplete'}>
			<td>
				<input type="checkbox" aria-label="Select" checked={selected} onChange={onToggle} />
			</td>
			<td>
				{manual ? (
					<input type="date" value={t.date} onChange={e => e.target.value && onChange({ date: e.target.value })} />
				) : (
					t.date
				)}
			</td>
			<td>
				{manual ? (
					<LookupSelect label="Account" items={lookups.accounts} value={t.account_id} onChange={id => id && onChange({ account_id: id })} />
				) : (
					lookups.accounts.find(a => a.id === t.account_id)?.name
				)}
			</td>
			<td className="raw">{t.raw_description ?? <span className="muted">manual</span>}</td>
			<td>
				<LookupSelect label="Vendor" items={lookups.vendors} value={t.vendor_id} onChange={id => onChange({ vendor_id: id })} />
			</td>
			<td>
				<LookupSelect
					label="Transaction type"
					items={lookups.transactionTypes}
					value={t.transaction_type_id}
					invalid={t.transaction_type_id === null}
					onChange={id => onChange({ transaction_type_id: id })}
				/>
			</td>
			<td>
				<LookupSelect
					label="Management category"
					grouped
					items={lookups.managementCategories}
					value={t.management_category_id}
					invalid={t.management_category_id === null}
					onChange={id => onChange({ management_category_id: id })}
				/>
			</td>
			<td>
				<LookupSelect label="Enterprise" items={lookups.enterprises} value={t.enterprise_id} onChange={id => onChange({ enterprise_id: id })} />
			</td>
			<td className="num">
				{manual ? (
					<AmountInput value={t.amount} onCommit={amount => onChange({ amount })} />
				) : (
					<span className={Number(t.amount) < 0 ? 'out' : 'in'}>{formatMoney(t.amount)}</span>
				)}
			</td>
			<td>
				<CommitInput value={t.description} placeholder="Notes" onCommit={description => onChange({ description })} />
			</td>
			<td className="row-actions">
				{!manual && (
					<button className="link" title="Create a vendor rule from this row" onClick={onMakeRule}>
						+ rule
					</button>
				)}
				<button className="link danger" title="Delete draft" onClick={onDelete}>
					Delete
				</button>
			</td>
		</tr>
	)
}

// Negative for money out, positive for money in.
function AmountInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
	return (
		<CommitInput
			className="num"
			value={value}
			onCommit={onCommit}
			parse={v => {
				const n = Number(v.replace(/[$,\s]/g, ''))
				return v.trim() === '' || Number.isNaN(n) ? null : n.toFixed(2)
			}}
		/>
	)
}
