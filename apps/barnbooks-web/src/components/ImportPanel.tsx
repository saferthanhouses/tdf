import { useState } from 'react'
import { api, ApiError } from '../api'
import { useLookups } from '../lookups'

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
			<strong>Import bank CSV</strong>
			<select aria-label="Account" value={accountId ?? ''} onChange={e => setAccountId(Number(e.target.value))}>
				{importable.map(a => (
					<option key={a.id} value={a.id}>
						{a.name}
					</option>
				))}
			</select>
			<input key={inputKey} type="file" accept=".csv,text/csv" onChange={e => setFile(e.target.files?.[0] ?? null)} />
			<button className="primary" disabled={!file || !accountId || busy} onClick={submit}>
				{busy ? 'Importing…' : 'Import'}
			</button>
		</div>
	)
}
