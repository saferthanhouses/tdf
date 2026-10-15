import { useEffect, useRef, useState } from 'react'
import { api, type Transaction, type Vendor } from '../api'
import { LookupSelect, useLookups } from '../lookups'

export interface VendorRuleRequest {
	transaction: Transaction
	name: string
}

// Confirms a new vendor and its match rule before saving. On save the vendor is assigned to the
// originating draft (along with the chosen defaults), and onSaved runs so other drafts can be re-matched.
export function VendorRuleDialog({
	request,
	onClose,
	onSaved,
}: {
	request: VendorRuleRequest | null
	onClose: () => void
	onSaved: (vendor: Vendor) => Promise<void>
}) {
	const { lookups } = useLookups()
	const ref = useRef<HTMLDialogElement>(null)
	const [name, setName] = useState('')
	const [pattern, setPattern] = useState('')
	const [typeId, setTypeId] = useState<number | null>(null)
	const [categoryId, setCategoryId] = useState<number | null>(null)
	const [enterpriseId, setEnterpriseId] = useState<number | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [saving, setSaving] = useState(false)

	useEffect(() => {
		const dialog = ref.current
		if (!dialog) return
		if (request) {
			const t = request.transaction
			setName(request.name)
			setPattern(t.raw_description ?? request.name)
			setTypeId(t.transaction_type_id)
			setCategoryId(t.management_category_id)
			setEnterpriseId(t.enterprise_id)
			setError(null)
			if (!dialog.open) dialog.showModal()
		} else if (dialog.open) {
			dialog.close()
		}
	}, [request])

	const save = async () => {
		if (!request) return
		setSaving(true)
		try {
			const vendor = (await api.createLookup('vendors', {
				name: name.trim(),
				match_pattern: pattern.trim(),
				default_transaction_type_id: typeId,
				default_management_category_id: categoryId,
				default_enterprise_id: enterpriseId,
			})) as Vendor
			await api.updateTransaction(request.transaction.id, {
				vendor_id: vendor.id,
				transaction_type_id: typeId ?? request.transaction.transaction_type_id,
				management_category_id: categoryId ?? request.transaction.management_category_id,
				enterprise_id: enterpriseId ?? request.transaction.enterprise_id,
			})
			await onSaved(vendor)
		} catch (e) {
			setError((e as Error).message)
		} finally {
			setSaving(false)
		}
	}

	const bank = request?.transaction.raw_description
	const patternMatchesBank = !bank || bank.toLowerCase().includes(pattern.trim().toLowerCase())

	return (
		<dialog ref={ref} className="vendor-dialog" onClose={onClose}>
			<form
				method="dialog"
				onSubmit={e => {
					e.preventDefault()
					void save()
				}}
			>
				<h2>New vendor rule</h2>
				{bank && (
					<p className="muted">
						Bank description: <code>{bank}</code>
					</p>
				)}

				<label>
					Vendor name
					<input value={name} onChange={e => setName(e.target.value)} required autoFocus />
				</label>

				<label>
					Text to match
					<input value={pattern} onChange={e => setPattern(e.target.value)} required />
					<span className="field-hint">
						Drafts whose bank description contains this text (ignoring case) get this vendor. Trim it to the part
						that identifies the vendor, e.g. drop store numbers and towns.
					</span>
					{!patternMatchesBank && <span className="field-warning">This doesn’t match this row’s bank description.</span>}
				</label>

				<fieldset>
					<legend>Defaults for matched drafts</legend>
					<label>
						Type
						<LookupSelect label="Default type" items={lookups.transactionTypes} value={typeId} onChange={setTypeId} />
					</label>
					<label>
						Management category
						<LookupSelect
							label="Default category"
							grouped
							items={lookups.managementCategories}
							value={categoryId}
							onChange={setCategoryId}
						/>
					</label>
					<label>
						Enterprise
						<LookupSelect label="Default enterprise" items={lookups.enterprises} value={enterpriseId} onChange={setEnterpriseId} />
					</label>
				</fieldset>

				{error && <p className="error">{error}</p>}

				<div className="dialog-actions">
					<button type="button" onClick={() => ref.current?.close()}>
						Cancel
					</button>
					<button type="submit" className="primary" disabled={saving || !name.trim() || !pattern.trim()}>
						{saving ? 'Saving…' : 'Save vendor'}
					</button>
				</div>
			</form>
		</dialog>
	)
}
