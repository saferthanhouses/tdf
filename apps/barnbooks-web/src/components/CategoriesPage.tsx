import { useState } from 'react'
import { api, groupLabels, type LookupKind, type ManagementCategoryGroup, type Vendor } from '../api'
import { LookupSelect, useLookups } from '../lookups'
import { CommitInput } from './CommitInput'
import { MatchPatternChips } from './MatchPatterns'

const groups = Object.keys(groupLabels) as ManagementCategoryGroup[]

export function CategoriesPage() {
	const { lookups, reload } = useLookups()
	const [error, setError] = useState<string | null>(null)

	const save = async (action: () => Promise<unknown>) => {
		try {
			await action()
			setError(null)
		} catch (e) {
			setError((e as Error).message)
		}
		await reload()
	}

	return (
		<section className="categories">
			{error && <p className="error">{error}</p>}
			<p className="muted">
				Archived entries disappear from dropdowns but stay on existing transactions. Rename freely — transactions
				reference the entry, not its name.
			</p>

			<LookupList title="Transaction types" kind="transaction-types" items={lookups.transactionTypes} save={save} />

			<LookupList
				title="Management categories"
				kind="management-categories"
				items={lookups.managementCategories}
				save={save}
				withGroup
			/>

			<LookupList title="Enterprises" kind="enterprises" items={lookups.enterprises} save={save} />

			<VendorList vendors={lookups.vendors} save={save} />
		</section>
	)
}

function LookupList({
	title,
	kind,
	items,
	save,
	withGroup = false,
}: {
	title: string
	kind: LookupKind
	items: { id: number; name: string; archived: boolean; group?: ManagementCategoryGroup }[]
	save: (action: () => Promise<unknown>) => Promise<void>
	withGroup?: boolean
}) {
	const [name, setName] = useState('')
	const [group, setGroup] = useState<ManagementCategoryGroup>('direct_production')

	const add = () =>
		save(async () => {
			await api.createLookup(kind, withGroup ? { name: name.trim(), group } : { name: name.trim() })
			setName('')
		})

	const sorted = withGroup ? [...items].sort((a, b) => groups.indexOf(a.group!) - groups.indexOf(b.group!)) : items

	return (
		<div className="lookup-list">
			<h2>{title}</h2>
			<table>
				<tbody>
					{sorted.map(item => (
						<tr key={item.id} className={item.archived ? 'archived' : undefined}>
							<td>
								<CommitInput value={item.name} parse={v => v.trim() || null} onCommit={v => save(() => api.updateLookup(kind, item.id, { name: v }))} />
							</td>
							{withGroup && (
								<td>
									<GroupSelect value={item.group!} onChange={g => save(() => api.updateLookup(kind, item.id, { group: g }))} />
								</td>
							)}
							<td className="row-actions">
								<button className="link" onClick={() => save(() => api.updateLookup(kind, item.id, { archived: !item.archived }))}>
									{item.archived ? 'Restore' : 'Archive'}
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<form
				className="add-row"
				onSubmit={e => {
					e.preventDefault()
					if (name.trim()) void add()
				}}
			>
				<input value={name} onChange={e => setName(e.target.value)} placeholder={`New ${title.toLowerCase().replace(/s$/, '')}`} />
				{withGroup && <GroupSelect value={group} onChange={setGroup} />}
				<button type="submit" disabled={!name.trim()}>
					Add
				</button>
			</form>
		</div>
	)
}

function GroupSelect({ value, onChange }: { value: ManagementCategoryGroup; onChange: (g: ManagementCategoryGroup) => void }) {
	return (
		<select aria-label="P&L group" value={value} onChange={e => onChange(e.target.value as ManagementCategoryGroup)}>
			{groups.map(g => (
				<option key={g} value={g}>
					{groupLabels[g]}
				</option>
			))}
		</select>
	)
}

function VendorList({ vendors, save }: { vendors: Vendor[]; save: (action: () => Promise<unknown>) => Promise<void> }) {
	const { lookups } = useLookups()
	const [name, setName] = useState('')
	const [pattern, setPattern] = useState('')
	const update = (id: number, body: Record<string, unknown>) => save(() => api.updateLookup('vendors', id, body))

	return (
		<div className="lookup-list vendors">
			<h2>Vendors</h2>
			<p className="muted">
				When a bank description contains any of a vendor’s match texts, that vendor and its defaults are applied to the
				draft. Add one per spelling your banks use. If several match, the longest wins.
			</p>
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Match text (any of)</th>
						<th>Default type</th>
						<th>Default category</th>
						<th>Default enterprise</th>
						<th />
					</tr>
				</thead>
				<tbody>
					{vendors.map(v => (
						<tr key={v.id}>
							<td>
								<CommitInput value={v.name} parse={x => x.trim() || null} onCommit={x => update(v.id, { name: x })} />
							</td>
							<td>
								<MatchPatternChips value={v.match_patterns} onChange={ps => update(v.id, { match_patterns: ps })} />
							</td>
							<td>
								<LookupSelect
									label="Default type"
									items={lookups.transactionTypes}
									value={v.default_transaction_type_id}
									onChange={id => update(v.id, { default_transaction_type_id: id })}
								/>
							</td>
							<td>
								<LookupSelect
									label="Default category"
									grouped
									items={lookups.managementCategories}
									value={v.default_management_category_id}
									onChange={id => update(v.id, { default_management_category_id: id })}
								/>
							</td>
							<td>
								<LookupSelect
									label="Default enterprise"
									items={lookups.enterprises}
									value={v.default_enterprise_id}
									onChange={id => update(v.id, { default_enterprise_id: id })}
								/>
							</td>
							<td className="row-actions">
								<button
									className="link danger"
									onClick={() => window.confirm(`Delete vendor “${v.name}”?`) && save(() => api.deleteVendor(v.id))}
								>
									Delete
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<form
				className="add-row"
				onSubmit={e => {
					e.preventDefault()
					void save(async () => {
						await api.createLookup('vendors', { name: name.trim(), match_patterns: [(pattern || name).trim()] })
						setName('')
						setPattern('')
					})
				}}
			>
				<input value={name} onChange={e => setName(e.target.value)} placeholder="Vendor name" />
				<input value={pattern} onChange={e => setPattern(e.target.value)} placeholder="Match text (defaults to name)" />
				<button type="submit" disabled={!name.trim()}>
					Add
				</button>
			</form>
		</div>
	)
}
