import { useState } from 'react'
import { api, ApiError, type SquareImport } from '../api'
import { useLookups } from '../lookups'
import { formatMoney } from '../format'

export function ImportPanel({
	onImported,
	onError,
}: {
	onImported: (message: string, accountId: number) => void
	onError: (message: string) => void
}) {
	const { lookups } = useLookups()
	const importable = lookups.accounts.filter(a => a.import_format !== null)
	const [accountId, setAccountId] = useState<number | null>(importable[0]?.id ?? null)
	const [file, setFile] = useState<File | null>(null)
	const [busy, setBusy] = useState(false)
	const [inputKey, setInputKey] = useState(0)
	const square = lookups.accounts.find(a => a.id === accountId)?.import_format === 'square'

	const submit = async () => {
		if (!file || !accountId) return
		setBusy(true)
		try {
			const result = await api.importCsv({ accountId, filename: file.name, csv: await file.text() })
			setFile(null)
			setInputKey(k => k + 1)
			onImported(
				`Imported ${result.imported} new draft(s) from ${file.name}` +
					(result.duplicates ? `; skipped ${result.duplicates} already imported.` : '.'),
				accountId,
			)
		} catch (e) {
			const rows = e instanceof ApiError ? (e.details?.rowErrors ?? []) : []
			onError([(e as Error).message, ...rows.slice(0, 5).map(r => `Line ${r.line}: ${r.message}`)].join(' · '))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="import-panel">
			<strong>{square ? 'Import Square sales' : 'Import bank CSV'}</strong>
			<select aria-label="Account" value={accountId ?? ''} onChange={e => setAccountId(Number(e.target.value))}>
				{importable.map(a => (
					<option key={a.id} value={a.id}>
						{a.name}
					</option>
				))}
			</select>
			{square ? (
				<SquareImportForm onImported={onImported} onError={onError} />
			) : (
				<>
					<input key={inputKey} type="file" accept=".csv,text/csv" onChange={e => setFile(e.target.files?.[0] ?? null)} />
					<button className="primary" disabled={!file || !accountId || busy} onClick={submit}>
						{busy ? 'Importing…' : 'Import'}
					</button>
				</>
			)}
		</div>
	)
}

const cents = (c: number) => formatMoney(c / 100)

// Square's two summary exports for one date range: category sales (required) and the sales summary (fees,
// card/cash). Choosing files previews the import; importing then offers to re-type Square's bank payouts.
function SquareImportForm({ onImported, onError }: { onImported: (message: string, accountId: number) => void; onError: (message: string) => void }) {
	const { nameOf, reload } = useLookups()
	const [files, setFiles] = useState<{ filename: string; csv: string }[]>([])
	const [range, setRange] = useState<{ from: string; to: string } | null>(null)
	const [preview, setPreview] = useState<SquareImport | null>(null)
	const [done, setDone] = useState<SquareImport | null>(null)
	const [payoutIds, setPayoutIds] = useState<Set<number>>(new Set())
	const [busy, setBusy] = useState(false)
	const [inputKey, setInputKey] = useState(0)

	const check = async (next: typeof files, nextRange: typeof range) => {
		setPreview(null)
		if (!next.length) return
		setBusy(true)
		try {
			const p = await api.importSquare({ files: next, ...nextRange, preview: true })
			setPreview(p)
			setRange({ from: p.from, to: p.to })
		} catch (e) {
			onError((e as Error).message)
		} finally {
			setBusy(false)
		}
	}

	const choose = async (list: FileList | null) => {
		const next = await Promise.all([...(list ?? [])].map(async f => ({ filename: f.name, csv: await f.text() })))
		setFiles(next)
		setDone(null)
		setRange(null)
		await check(next, null)
	}

	const changeRange = (key: 'from' | 'to', value: string) => {
		if (!range || !value) return
		const next = { ...range, [key]: value }
		setRange(next)
		void check(files, next)
	}

	const submit = async () => {
		setBusy(true)
		try {
			const result = await api.importSquare({ files, ...range!, preview: false })
			setDone(result)
			setPreview(null)
			setFiles([])
			setInputKey(k => k + 1)
			setPayoutIds(new Set(result.payouts.filter(p => p.likely).map(p => p.id)))
			await reload()
			onImported(`Imported ${result.imported} Square draft(s) for ${result.from} – ${result.to}.`, result.accountId)
		} catch (e) {
			onError((e as Error).message)
		} finally {
			setBusy(false)
		}
	}

	const retype = async () => {
		setBusy(true)
		try {
			const { retyped } = await api.retypeSquarePayouts([...payoutIds])
			setDone(null)
			onImported(`Re-typed ${retyped} Square payout(s) as transfers.`, done!.accountId)
		} catch (e) {
			onError((e as Error).message)
		} finally {
			setBusy(false)
		}
	}

	const shown = preview ?? done
	const selectedCents = done ? done.payouts.filter(p => payoutIds.has(p.id)).reduce((s, p) => s + p.cents, 0) : 0

	return (
		<>
			<input
				key={inputKey}
				type="file"
				multiple
				accept=".csv,text/csv"
				aria-label="Square category sales and sales summary CSVs"
				onChange={e => void choose(e.target.files)}
			/>
			{range && preview && (
				<>
					<label>
						From <input type="date" value={range.from} onChange={e => changeRange('from', e.target.value)} />
					</label>
					<label>
						To <input type="date" value={range.to} onChange={e => changeRange('to', e.target.value)} />
					</label>
				</>
			)}
			{preview && (
				<button className="primary" disabled={busy || !!preview.overlap} onClick={submit}>
					{busy ? 'Importing…' : `Import ${preview.categories.length + (preview.summary?.feesCents ? 1 : 0)} drafts`}
				</button>
			)}
			<span className="muted">Square → Reports → Sales summary and Category sales, exported for the same dates.</span>

			{shown && (
				<div className="square-preview">
					{shown.overlap && <p className="error">{shown.overlap}</p>}
					{shown.warnings.map(w => (
						<p key={w} className="notice">
							{w}
						</p>
					))}
					{preview && (
						<table>
							<thead>
								<tr>
									<th>Square category</th>
									<th>Management category</th>
									<th>Enterprise</th>
									<th className="num">Net sales</th>
								</tr>
							</thead>
							<tbody>
								{preview.categories.map(c => (
									<tr key={c.name}>
										<td>
											{c.name} {c.isNew && <span className="badge">new</span>}
										</td>
										<td>{nameOf('managementCategories', c.managementCategoryId)}</td>
										<td className={c.enterpriseId === null ? 'muted' : undefined}>{nameOf('enterprises', c.enterpriseId) || 'not set'}</td>
										<td className="num">{cents(c.netCents)}</td>
									</tr>
								))}
							</tbody>
							{preview.summary && (
								<tfoot>
									<tr>
										<td colSpan={3}>Net sales · card {cents(preview.summary.cardCents)}, cash {cents(preview.summary.cashCents)}</td>
										<td className="num">{cents(preview.summary.netCents)}</td>
									</tr>
									<tr>
										<td colSpan={3}>Square fees</td>
										<td className="num out">{cents(preview.summary.feesCents)}</td>
									</tr>
								</tfoot>
							)}
						</table>
					)}
					{preview && preview.categories.some(c => c.isNew || c.enterpriseId === null) && (
						<p className="muted">Set where each Square category’s sales go on Categories &amp; vendors → Square categories; drafts follow.</p>
					)}

					{done && done.payouts.length > 0 && (
						<div className="square-payouts">
							<p>
								Square’s payouts to the bank are this same money, so they should be <strong>transfers</strong>, not income.
								{done.expectedPayoutCents !== null && <> Expected payouts (card less fees): {cents(done.expectedPayoutCents)}.</>}
							</p>
							{done.payouts.map(p => (
								<label key={p.id} className="payout">
									<input
										type="checkbox"
										checked={payoutIds.has(p.id)}
										onChange={e =>
											setPayoutIds(s => {
												const next = new Set(s)
												if (e.target.checked) next.add(p.id)
												else next.delete(p.id)
												return next
											})
										}
									/>
									{p.date} · {nameOf('accounts', p.accountId)} · {p.description} · {cents(p.cents)}
								</label>
							))}
							<button disabled={busy || payoutIds.size === 0} onClick={retype}>
								Re-type {payoutIds.size} payout(s) ({cents(selectedCents)}) as transfers
							</button>
							<button className="link" onClick={() => setDone(null)}>
								Not now
							</button>
						</div>
					)}
				</div>
			)}
		</>
	)
}
