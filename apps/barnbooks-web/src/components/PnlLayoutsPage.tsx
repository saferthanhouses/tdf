import { useEffect, useMemo, useState } from 'react'
import { api, groupLabels, type ManagementCategoryGroup, type PnlLayout, type PnlLayoutPreview, type PnlLayoutRow, type PnlRowInput, type PnlRowKind, type PnlSplit } from '../api'
import { useLookups } from '../lookups'
import { formatMoney } from '../format'
import { CommitInput } from './CommitInput'

// Editor for saved P&L layouts: the rows a report shows, what each line counts, and how totals and percentages
// are worked out. Changes are made to a draft, previewed against posted transactions, then saved.

const KIND_LABELS: Record<PnlRowKind, string> = {
	lines: 'Lines',
	total: 'Total',
	percent: 'Percentage',
	heading: 'Heading',
	spacer: 'Spacer',
}
const SPLIT_LABELS: Record<PnlSplit, string> = {
	none: 'One line',
	category: 'A line per management category',
	enterprise: 'A line per enterprise',
	type: 'A line per transaction type',
}
const GROUPS = Object.keys(groupLabels) as ManagementCategoryGroup[]

const toInput = (r: PnlLayoutRow): PnlRowInput => ({
	key: String(r.id),
	kind: r.kind,
	label: r.label,
	typeIds: r.typeIds,
	categoryIds: r.categoryIds,
	categoryGroups: r.categoryGroups,
	enterpriseIds: r.enterpriseIds,
	accountIds: r.accountIds,
	splitBy: r.splitBy,
	totalLabel: r.totalLabel,
	sumRowKeys: r.sumRowIds.map(String),
	emphasis: r.emphasis,
	numeratorKey: r.numeratorRowId === null ? null : String(r.numeratorRowId),
	denominatorKey: r.denominatorRowId === null ? null : String(r.denominatorRowId),
})

let nextKey = 1
const newRow = (kind: PnlRowKind): PnlRowInput => ({
	key: `new-${nextKey++}`,
	kind,
	label: kind === 'lines' ? 'New line' : kind === 'total' ? 'New total' : kind === 'percent' ? 'New percentage' : kind === 'heading' ? 'New heading' : '',
	typeIds: [],
	categoryIds: [],
	categoryGroups: [],
	enterpriseIds: [],
	accountIds: [],
	splitBy: 'none',
	totalLabel: null,
	sumRowKeys: [],
	emphasis: false,
	numeratorKey: null,
	denominatorKey: null,
})

// Totals and percentages may only use lines and totals above them (the server checks this too).
function problemsOf(rows: PnlRowInput[]): Map<string, string> {
	const problems = new Map<string, string>()
	rows.forEach((row, i) => {
		const usable = (key: string | null) => {
			const j = rows.findIndex(r => r.key === key)
			return j >= 0 && j < i && (rows[j]!.kind === 'lines' || rows[j]!.kind === 'total')
		}
		if (row.kind === 'total' && !row.sumRowKeys.every(usable)) problems.set(row.key, 'Adds a row that is now below it; move it back up or untick it.')
		if (row.kind === 'percent' && !(usable(row.numeratorKey) && usable(row.denominatorKey)))
			problems.set(row.key, 'Choose two rows above this one.')
	})
	return problems
}

const layoutIdFromUrl = () => {
	const v = new URLSearchParams(window.location.search).get('layout')
	return v && /^\d+$/.test(v) ? Number(v) : null
}

export function PnlLayoutsPage() {
	const [layouts, setLayouts] = useState<PnlLayout[] | null>(null)
	const [layoutId, setLayoutId] = useState<number | null>(layoutIdFromUrl)
	const [saved, setSaved] = useState<PnlRowInput[]>([])
	const [rows, setRows] = useState<PnlRowInput[]>([])
	const [previewYear, setPreviewYear] = useState<number | null>(null)
	const [preview, setPreview] = useState<PnlLayoutPreview | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [newName, setNewName] = useState<string | null>(null)

	const layout = layouts?.find(l => l.id === layoutId) ?? layouts?.[0] ?? null
	const dirty = JSON.stringify(rows) !== JSON.stringify(saved)
	const problems = useMemo(() => problemsOf(rows), [rows])

	const load = async (select?: number) => {
		try {
			const list = await api.pnlLayouts()
			setLayouts(list)
			const current = list.find(l => l.id === (select ?? layoutId)) ?? list[0]
			if (current) {
				setLayoutId(current.id)
				const inputs = current.rows.map(toInput)
				setSaved(inputs)
				setRows(inputs)
			}
			setError(null)
		} catch (e) {
			setError((e as Error).message)
		}
	}
	useEffect(() => {
		void load()
	}, [])

	// Keep the chosen layout in the URL; clear it when leaving the page.
	useEffect(() => {
		const { pathname, hash } = window.location
		window.history.replaceState(null, '', pathname + (layout ? `?layout=${layout.id}` : '') + hash)
	}, [layout])
	useEffect(() => () => window.history.replaceState(null, '', window.location.pathname + window.location.hash), [])

	// Preview totals for the draft, shortly after edits stop.
	useEffect(() => {
		if (!layout) return
		let current = true
		const timer = setTimeout(() => {
			api.previewPnlLayout(rows, previewYear).then(
				p => current && setPreview(p),
				() => current && setPreview(null),
			)
		}, 300)
		return () => {
			current = false
			clearTimeout(timer)
		}
	}, [rows, previewYear, layout])

	const run = async (action: () => Promise<void>, done?: string) => {
		setBusy(true)
		try {
			await action()
			setError(null)
			setNotice(done ?? null)
		} catch (e) {
			setError((e as Error).message)
			setNotice(null)
		} finally {
			setBusy(false)
		}
	}

	const switchTo = (id: number) => {
		if (dirty && !window.confirm('Discard unsaved changes to this layout?')) return
		void load(id)
	}
	const save = () =>
		run(async () => {
			const { rows: savedRows } = await api.savePnlLayoutRows(layout!.id, rows)
			const inputs = savedRows.map(toInput)
			setSaved(inputs)
			setRows(inputs)
			setLayouts(ls => ls?.map(l => (l.id === layout!.id ? { ...l, rows: savedRows } : l)) ?? null)
		}, 'Saved.')
	const create = (name: string, copyFrom?: number) =>
		run(async () => {
			if (dirty && !window.confirm('Discard unsaved changes to this layout?')) return
			const created = await api.createPnlLayout({ name, copyFrom })
			setNewName(null)
			await load(created.id)
		}, copyFrom ? 'Duplicated.' : 'Created.')
	const remove = () =>
		window.confirm(`Delete the layout “${layout!.name}”? Reports using it switch to another layout.`) &&
		run(async () => {
			await api.deletePnlLayout(layout!.id)
			await load(layouts!.find(l => l.id !== layout!.id)?.id)
		}, 'Deleted.')

	const update = (key: string, change: Partial<PnlRowInput>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...change } : r)))
	const move = (i: number, by: -1 | 1) =>
		setRows(rs => {
			const next = [...rs]
			const [row] = next.splice(i, 1)
			next.splice(i + by, 0, row!)
			return next
		})
	// Removing a row also drops it from totals that added it.
	const removeRow = (key: string) =>
		setRows(rs =>
			rs
				.filter(r => r.key !== key)
				.map(r => ({
					...r,
					sumRowKeys: r.sumRowKeys.filter(k => k !== key),
					numeratorKey: r.numeratorKey === key ? null : r.numeratorKey,
					denominatorKey: r.denominatorKey === key ? null : r.denominatorKey,
				})),
		)

	if (!layouts) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>
	const years = [...new Set([...(previewYear ? [previewYear] : []), ...(preview?.availableYears ?? [])])].sort((a, b) => b - a)

	return (
		<section className="pnl-layouts">
			<div className="toolbar">
				<h2>P&amp;L layouts</h2>
				<select aria-label="Layout" value={layout?.id ?? ''} onChange={e => switchTo(Number(e.target.value))}>
					{layouts.map(l => (
						<option key={l.id} value={l.id}>
							{l.name}
						</option>
					))}
				</select>
				{layout && (
					<>
						<button disabled={busy} onClick={() => create(uniqueName(`${layout.name} (copy)`, layouts), layout.id)}>
							Duplicate
						</button>
						<button className="danger" disabled={busy || layouts.length <= 1} onClick={remove} title={layouts.length <= 1 ? 'Keep at least one layout' : undefined}>
							Delete
						</button>
					</>
				)}
				{newName === null ? (
					<button disabled={busy} onClick={() => setNewName('')}>
						New layout
					</button>
				) : (
					<form
						className="inline-form"
						onSubmit={e => {
							e.preventDefault()
							if (newName.trim()) void create(newName.trim())
						}}
					>
						<input autoFocus aria-label="New layout name" placeholder="Layout name" value={newName} onChange={e => setNewName(e.target.value)} />
						<button type="submit" className="primary" disabled={!newName.trim() || busy}>
							Create
						</button>
						<button type="button" className="link" onClick={() => setNewName(null)}>
							Cancel
						</button>
					</form>
				)}
				<div className="spacer" />
				<a className="button-link" href={`?layout=${layout?.id ?? ''}#pnl`}>
					View report
				</a>
			</div>

			{error && <p className="error">{error}</p>}
			{notice && !dirty && <p className="notice">{notice}</p>}

			{layout && (
				<>
					<div className="layout-meta">
						<label>
							Name{' '}
							<CommitInput
								value={layout.name}
								parse={v => v.trim() || null}
								onCommit={name =>
									run(async () => {
										await api.renamePnlLayout(layout.id, name)
										setLayouts(ls => ls?.map(l => (l.id === layout.id ? { ...l, name } : l)) ?? null)
									}, 'Renamed.')
								}
							/>
						</label>
						<label>
							Preview totals for{' '}
							<select value={previewYear ?? ''} onChange={e => setPreviewYear(e.target.value ? Number(e.target.value) : null)}>
								{years.map(y => (
									<option key={y} value={y}>
										{y}
									</option>
								))}
								<option value="">All time</option>
							</select>
						</label>
						{preview && <Coverage coverage={preview.coverage} />}
					</div>

					<ol className="layout-rows">
						{rows.map((row, i) => (
							<RowEditor
								key={row.key}
								row={row}
								above={rows.slice(0, i)}
								total={preview?.totals[row.key]}
								problem={problems.get(row.key)}
								onChange={change => update(row.key, change)}
								onMove={by => move(i, by)}
								canMoveUp={i > 0}
								canMoveDown={i < rows.length - 1}
								onRemove={() => removeRow(row.key)}
							/>
						))}
					</ol>

					<div className="layout-actions">
						<span className="muted">Add:</span>
						{(['lines', 'total', 'percent', 'heading', 'spacer'] as PnlRowKind[]).map(kind => (
							<button key={kind} onClick={() => setRows(rs => [...rs, newRow(kind)])}>
								+ {KIND_LABELS[kind]}
							</button>
						))}
						<div className="spacer" />
						{dirty && (
							<button className="link" onClick={() => setRows(saved)}>
								Discard changes
							</button>
						)}
						<button className="primary" disabled={!dirty || busy || problems.size > 0} onClick={save}>
							{busy ? 'Saving…' : 'Save layout'}
						</button>
					</div>
				</>
			)}
		</section>
	)
}

function uniqueName(base: string, layouts: PnlLayout[]) {
	let name = base
	for (let n = 2; layouts.some(l => l.name === name); n++) name = `${base} ${n}`
	return name
}

const money = (cents: number) => formatMoney(cents / 100)

function Coverage({ coverage }: { coverage: PnlLayoutPreview['coverage'] }) {
	const { unmatched, overlapping } = coverage
	if (!unmatched.count && !overlapping.count) return <span className="muted">Every posted transaction is in exactly one line.</span>
	return (
		<span className="coverage">
			{unmatched.count > 0 && (
				<span title="Posted transactions that no lines row includes. Fine for a partial report; for a full P&L, add lines for them.">
					{unmatched.count} transaction{unmatched.count === 1 ? '' : 's'} ({money(unmatched.cents)}) in no line
				</span>
			)}
			{overlapping.count > 0 && (
				<span className="warn" title="Posted transactions included by more than one lines row, so totals adding those rows count them twice.">
					{overlapping.count} transaction{overlapping.count === 1 ? '' : 's'} ({money(overlapping.cents)}) in more than one line
				</span>
			)}
		</span>
	)
}

function RowEditor({
	row,
	above,
	total,
	problem,
	onChange,
	onMove,
	canMoveUp,
	canMoveDown,
	onRemove,
}: {
	row: PnlRowInput
	above: PnlRowInput[]
	total: number | null | undefined
	problem?: string
	onChange: (change: Partial<PnlRowInput>) => void
	onMove: (by: -1 | 1) => void
	canMoveUp: boolean
	canMoveDown: boolean
	onRemove: () => void
}) {
	const { lookups } = useLookups()
	const usable = above.filter(r => r.kind === 'lines' || r.kind === 'total')
	const name = (r: PnlRowInput) => r.label || KIND_LABELS[r.kind]
	const shownTotal =
		total === undefined || total === null || row.kind === 'heading' || row.kind === 'spacer' ? null : row.kind === 'percent' ? `${total.toFixed(1)}%` : money(total)

	return (
		<li className={`layout-row layout-row-${row.kind}${problem ? ' has-problem' : ''}`}>
			<div className="layout-row-head">
				<div className="layout-row-move">
					<button className="icon-button" aria-label="Move up" title="Move up" disabled={!canMoveUp} onClick={() => onMove(-1)}>
						↑
					</button>
					<button className="icon-button" aria-label="Move down" title="Move down" disabled={!canMoveDown} onClick={() => onMove(1)}>
						↓
					</button>
				</div>
				<span className="badge">{KIND_LABELS[row.kind]}</span>
				{row.kind !== 'spacer' && <input aria-label="Label" className="layout-row-label" value={row.label} onChange={e => onChange({ label: e.target.value })} />}
				<div className="spacer" />
				{shownTotal !== null && <span className={`layout-row-total num${total! < 0 && row.kind !== 'percent' ? ' out' : ''}`}>{shownTotal}</span>}
				<button className="icon-button delete" aria-label={`Remove ${name(row)}`} title="Remove row" onClick={onRemove}>
					×
				</button>
			</div>

			{row.kind === 'lines' && (
				<div className="layout-row-body">
					<p className="muted">Posted transactions matching all of these (an empty choice means any):</p>
					<MultiPick label="Transaction types" items={lookups.transactionTypes} value={row.typeIds} onChange={v => onChange({ typeIds: v })} />
					<MultiPick
						label="Category groups"
						items={GROUPS.map((g, i) => ({ id: i, name: groupLabels[g] }))}
						value={row.categoryGroups.map(g => GROUPS.indexOf(g))}
						onChange={v => onChange({ categoryGroups: v.map(i => GROUPS[i]!) })}
					/>
					<MultiPick label="Management categories" items={lookups.managementCategories} value={row.categoryIds} onChange={v => onChange({ categoryIds: v })} />
					<MultiPick label="Enterprises" items={lookups.enterprises} value={row.enterpriseIds} onChange={v => onChange({ enterpriseIds: v })} />
					<MultiPick label="Accounts" items={lookups.accounts} value={row.accountIds} onChange={v => onChange({ accountIds: v })} />
					<div className="layout-field">
						<span>Show as</span>
						<select aria-label="Show as" value={row.splitBy} onChange={e => onChange({ splitBy: e.target.value as PnlSplit })}>
							{(Object.keys(SPLIT_LABELS) as PnlSplit[]).map(s => (
								<option key={s} value={s}>
									{SPLIT_LABELS[s]}
								</option>
							))}
						</select>
						{row.splitBy !== 'none' && (
							<input
								aria-label="Total line label"
								placeholder={`Total ${row.label.toLowerCase()}`}
								value={row.totalLabel ?? ''}
								onChange={e => onChange({ totalLabel: e.target.value || null })}
							/>
						)}
					</div>
				</div>
			)}

			{row.kind === 'total' && (
				<div className="layout-row-body">
					<div className="layout-field">
						<span>Adds</span>
						{usable.length === 0 ? (
							<span className="muted">No lines or totals above this row yet.</span>
						) : (
							<span className="layout-checks">
								{usable.map(r => (
									<label key={r.key}>
										<input
											type="checkbox"
											checked={row.sumRowKeys.includes(r.key)}
											onChange={e =>
												onChange({
													sumRowKeys: e.target.checked ? [...row.sumRowKeys, r.key] : row.sumRowKeys.filter(k => k !== r.key),
												})
											}
										/>
										{name(r)}
									</label>
								))}
							</span>
						)}
					</div>
					<p className="muted">Amounts are signed (costs are negative), so adding Revenue and Direct costs gives the gross margin.</p>
					<label className="layout-field">
						<input type="checkbox" checked={row.emphasis} onChange={e => onChange({ emphasis: e.target.checked })} /> Emphasise (bold, ruled above)
					</label>
				</div>
			)}

			{row.kind === 'percent' && (
				<div className="layout-row-body">
					<div className="layout-field">
						<RowSelect label="Numerator" rows={usable} value={row.numeratorKey} onChange={k => onChange({ numeratorKey: k })} />
						<span>as a percentage of</span>
						<RowSelect label="Denominator" rows={usable} value={row.denominatorKey} onChange={k => onChange({ denominatorKey: k })} />
					</div>
				</div>
			)}

			{problem && <p className="error">{problem}</p>}
		</li>
	)
}

function RowSelect({ label, rows, value, onChange }: { label: string; rows: PnlRowInput[]; value: string | null; onChange: (key: string | null) => void }) {
	return (
		<select aria-label={label} value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
			<option value="">Choose a row…</option>
			{rows.map(r => (
				<option key={r.key} value={r.key}>
					{r.label || KIND_LABELS[r.kind]}
				</option>
			))}
		</select>
	)
}

// Chosen items as removable chips, plus a dropdown to add more. Nothing chosen means "any".
function MultiPick({ label, items, value, onChange }: { label: string; items: { id: number; name: string; archived?: boolean }[]; value: number[]; onChange: (ids: number[]) => void }) {
	const remaining = items.filter(i => !value.includes(i.id) && !i.archived)
	const nameOf = (id: number) => items.find(i => i.id === id)?.name ?? `#${id}`
	return (
		<div className="layout-field">
			<span>{label}</span>
			<span className="pattern-chips">
				{value.length === 0 && <span className="muted">any</span>}
				{value.map(id => (
					<span key={id} className="pattern-chip multi-chip">
						{nameOf(id)}
						<button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => onChange(value.filter(v => v !== id))}>
							×
						</button>
					</span>
				))}
				{remaining.length > 0 && (
					<select
						aria-label={`Add to ${label.toLowerCase()}`}
						className="multi-add"
						value=""
						onChange={e => e.target.value && onChange([...value, Number(e.target.value)])}
					>
						<option value="">+ Add…</option>
						{remaining.map(i => (
							<option key={i.id} value={i.id}>
								{i.name}
							</option>
						))}
					</select>
				)}
			</span>
		</div>
	)
}
