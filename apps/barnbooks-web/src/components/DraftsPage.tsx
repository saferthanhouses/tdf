import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Transaction, type TransactionEdit, type Vendor } from '../api'
import { LookupSelect, useLookups } from '../lookups'
import { formatMoney, localToday } from '../format'
import { ImportPanel } from './ImportPanel'
import { CommitInput } from './CommitInput'
import { VendorCombobox } from './VendorCombobox'
import { VendorRuleDialog, type VendorRuleRequest } from './VendorRuleDialog'

const isComplete = (t: Transaction) => t.transaction_type_id !== null && t.management_category_id !== null

interface Message {
	kind: 'info' | 'error'
	text: string
	undo?: () => void
}

export function DraftsPage() {
	const { lookups, reload: reloadLookups } = useLookups()
	const [drafts, setDrafts] = useState<Transaction[] | null>(null)
	const [selected, setSelected] = useState<Set<number>>(new Set())
	const [message, setMessage] = useState<Message | null>(null)
	// Index of the last checkbox clicked, for shift-click range selection.
	const lastClicked = useRef<number | null>(null)
	const [vendorRule, setVendorRule] = useState<VendorRuleRequest | null>(null)
	const [tabAccountId, setTabAccountId] = useState<number | null>(null)

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

	// Default to the first account that has drafts.
	const accountId =
		tabAccountId ?? lookups.accounts.find(a => drafts?.some(d => d.account_id === a.id))?.id ?? lookups.accounts[0]?.id ?? null
	const account = lookups.accounts.find(a => a.id === accountId)
	const visible = drafts?.filter(d => d.account_id === accountId) ?? []

	const switchAccount = (id: number) => {
		setTabAccountId(id)
		setSelected(new Set())
		lastClicked.current = null
	}

	const toggle = (index: number, shiftKey: boolean) => {
		const id = visible[index]!.id
		const select = !selected.has(id)
		const anchor = shiftKey && lastClicked.current !== null && lastClicked.current < visible.length ? lastClicked.current : index
		const [from, to] = [Math.min(anchor, index), Math.max(anchor, index)]
		setSelected(s => {
			const next = new Set(s)
			for (const d of visible.slice(from, to + 1)) {
				if (select) next.add(d.id)
				else next.delete(d.id)
			}
			return next
		})
		lastClicked.current = index
	}

	const remove = async (ids: number[]) => {
		if (!drafts || !ids.length) return
		// Manual drafts have no bank row to dismiss against, so they are deleted outright.
		const manual = drafts.filter(d => ids.includes(d.id) && d.dedupe_hash === null).length
		if (manual && !window.confirm(`${manual} manually entered draft(s) will be permanently deleted. Continue?`)) return
		try {
			const { dismissed, deleted } = await api.deleteTransactions(ids)
			const removed = new Set([...dismissed, ...deleted])
			setDrafts(ds => ds?.filter(d => !removed.has(d.id)) ?? null)
			setSelected(s => new Set([...s].filter(x => !removed.has(x))))
			lastClicked.current = null
			setMessage({
				kind: 'info',
				text: `Deleted ${removed.size} draft(s).`,
				undo: dismissed.length
					? () =>
							run(async () => {
								const { restored } = await api.restoreTransactions(dismissed)
								await load()
								return `Restored ${restored} draft(s).`
							})
					: undefined,
			})
		} catch (e) {
			setMessage({ kind: 'error', text: (e as Error).message })
		}
	}

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

	const onVendorSaved = async (vendor: Vendor) => {
		setVendorRule(null)
		const { matched } = await api.rematchDrafts()
		await Promise.all([reloadLookups(), load()])
		setMessage({ kind: 'info', text: `Saved vendor “${vendor.name}” and matched ${matched} other draft(s).` })
	}

	const addManual = () =>
		run(async () => {
			if (!account) return 'Add an account first'
			await api.createTransaction({
				date: localToday(),
				account_id: account.id,
				amount: '0',
				description: '',
			})
			await load()
			return `Added a draft to ${account.name} — set its amount and categories below.`
		})

	if (!drafts) return <p className="muted">Loading drafts…</p>

	const completeIds = visible.filter(isComplete).map(d => d.id)
	const allSelected = visible.length > 0 && selected.size === visible.length

	return (
		<section>
			<ImportPanel
				onImported={async (text, importedAccountId) => {
					await load()
					switchAccount(importedAccountId)
					setMessage({ kind: 'info', text })
				}}
				onError={text => setMessage({ kind: 'error', text })}
			/>

			<div className="toolbar">
				<h2>Drafts</h2>
				<div className="spacer" />
				<button onClick={addManual}>Add transaction</button>
				<button onClick={() => run(async () => `Matched ${(await api.rematchDrafts()).matched} draft(s) to vendors.`).then(load)}>
					Re-apply vendor rules
				</button>
				<button className="danger" disabled={!selected.size} onClick={() => remove([...selected])}>
					Delete selected ({selected.size})
				</button>
				<button disabled={!selected.size} onClick={() => post([...selected])}>
					Post selected ({selected.size})
				</button>
				<button className="primary" disabled={!completeIds.length} onClick={() => post(completeIds)}>
					Post all complete ({completeIds.length})
				</button>
			</div>

			{message && (
				<p className={message.kind === 'error' ? 'error' : 'notice'}>
					{message.text}
					{message.undo && (
						<button className="link" onClick={message.undo}>
							Undo
						</button>
					)}
				</p>
			)}

			<div className="account-tabs" role="tablist" aria-label="Account">
				{lookups.accounts.map(a => {
					const count = drafts.filter(d => d.account_id === a.id).length
					return (
						<button
							key={a.id}
							role="tab"
							aria-selected={a.id === accountId}
							className={a.id === accountId ? 'account-tab active' : 'account-tab'}
							onClick={() => switchAccount(a.id)}
						>
							{a.name} <span className="count">{count}</span>
						</button>
					)
				})}
			</div>

			{visible.length === 0 ? (
				<p className="muted account-empty">
					No drafts in {account?.name ?? 'this account'}.{' '}
					{account?.import_format ? 'Import a bank CSV above to get started.' : 'Use “Add transaction” to enter one.'}
				</p>
			) : (
				<div className="table-wrap account-panel">
					<table>
						<thead>
							<tr>
								<th>
									<input
										type="checkbox"
										aria-label="Select all"
										checked={allSelected}
										onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map(d => d.id)))}
									/>
								</th>
								<th>Date</th>
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
							{visible.map((t, index) => (
								<DraftRow
									key={t.id}
									t={t}
									selected={selected.has(t.id)}
									onToggle={shiftKey => toggle(index, shiftKey)}
									onChange={edit => update(t.id, edit)}
									onPost={() => post([t.id])}
									onDelete={() => remove([t.id])}
									onCreateVendor={name => setVendorRule({ transaction: t, name })}
								/>
							))}
						</tbody>
					</table>
				</div>
			)}

			<VendorRuleDialog request={vendorRule} onClose={() => setVendorRule(null)} onSaved={onVendorSaved} />
		</section>
	)
}

function DraftRow({
	t,
	selected,
	onToggle,
	onChange,
	onPost,
	onDelete,
	onCreateVendor,
}: {
	t: Transaction
	selected: boolean
	onToggle: (shiftKey: boolean) => void
	onChange: (edit: TransactionEdit) => void
	onPost: () => void
	onDelete: () => void
	onCreateVendor: (name: string) => void
}) {
	const { lookups } = useLookups()
	// Imported rows keep their bank date and amount; manual rows can edit them.
	const manual = t.raw_description === null

	return (
		<tr className={isComplete(t) ? undefined : 'incomplete'}>
			<td>
				<input
					type="checkbox"
					aria-label="Select (shift-click to select a range)"
					checked={selected}
					readOnly
					onClick={e => onToggle(e.shiftKey)}
				/>
			</td>
			<td>
				{manual ? (
					<input type="date" value={t.date} onChange={e => e.target.value && onChange({ date: e.target.value })} />
				) : (
					t.date
				)}
			</td>
			<td className="raw">{t.raw_description ?? <span className="muted">manual</span>}</td>
			<td>
				<VendorCombobox
					vendors={lookups.vendors}
					value={t.vendor_id}
					bankDescription={t.raw_description}
					onCreate={onCreateVendor}
					onSelect={vendor =>
						// Picking a vendor fills any empty category fields from its defaults.
						onChange({
							vendor_id: vendor?.id ?? null,
							...(vendor && {
								transaction_type_id: t.transaction_type_id ?? vendor.default_transaction_type_id,
								management_category_id: t.management_category_id ?? vendor.default_management_category_id,
								enterprise_id: t.enterprise_id ?? vendor.default_enterprise_id,
							}),
						})
					}
				/>
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
				<button
					className="icon-button post"
					aria-label="Post to ledger"
					title={isComplete(t) ? 'Post to ledger' : 'Set a type and management category to post'}
					disabled={!isComplete(t)}
					onClick={onPost}
				>
					<CheckIcon />
				</button>
				<button className="icon-button delete" aria-label="Delete draft" title="Delete draft" onClick={onDelete}>
					<CrossIcon />
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

const CheckIcon = () => (
	<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
		<path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
	</svg>
)

const CrossIcon = () => (
	<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
		<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
	</svg>
)
