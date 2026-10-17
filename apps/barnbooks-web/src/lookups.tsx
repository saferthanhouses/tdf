import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, groupLabels, type Lookups, type ManagementCategoryGroup } from './api'

interface LookupsContextValue {
	lookups: Lookups
	reload: () => Promise<void>
	nameOf: (list: keyof Lookups, id: number | null) => string
}

const LookupsContext = createContext<LookupsContextValue | null>(null)

// Vendors and categories can change outside this page (another window, a seed script), so the lists are
// refetched whenever `refreshKey` changes (e.g. switching tabs) and when the window regains focus.
export function LookupsProvider({ children, refreshKey }: { children: ReactNode; refreshKey?: unknown }) {
	const [lookups, setLookups] = useState<Lookups | null>(null)
	const [error, setError] = useState<string | null>(null)

	const reload = useCallback(async () => {
		try {
			setLookups(await api.lookups())
			setError(null)
		} catch (e) {
			setError((e as Error).message)
		}
	}, [])

	useEffect(() => {
		void reload()
	}, [reload, refreshKey])

	useEffect(() => {
		const refresh = () => {
			if (document.visibilityState === 'visible') void reload()
		}
		window.addEventListener('focus', refresh)
		document.addEventListener('visibilitychange', refresh)
		return () => {
			window.removeEventListener('focus', refresh)
			document.removeEventListener('visibilitychange', refresh)
		}
	}, [reload])

	const value = useMemo(() => {
		if (!lookups) return null
		const nameOf = (list: keyof Lookups, id: number | null) =>
			id === null ? '' : (lookups[list].find(item => item.id === id)?.name ?? `#${id}`)
		return { lookups, reload, nameOf }
	}, [lookups, reload])

	// A failed background refresh keeps showing the lists already loaded.
	if (!value) return error ? <p className="error">Could not load categories: {error}</p> : <p className="muted">Loading…</p>
	return <LookupsContext.Provider value={value}>{children}</LookupsContext.Provider>
}

export function useLookups() {
	const ctx = useContext(LookupsContext)
	if (!ctx) throw new Error('useLookups must be used inside LookupsProvider')
	return ctx
}

interface Option {
	id: number
	name: string
	archived?: boolean
	group?: ManagementCategoryGroup
}

// Archived options stay visible only when already selected, so old transactions keep their label.
export function LookupSelect({
	items,
	value,
	onChange,
	placeholder = '—',
	grouped = false,
	invalid = false,
	label,
}: {
	items: Option[]
	value: number | null
	onChange: (id: number | null) => void
	placeholder?: string
	grouped?: boolean
	invalid?: boolean
	label: string
}) {
	const visible = items.filter(i => !i.archived || i.id === value)
	const options = (list: Option[]) =>
		list.map(i => (
			<option key={i.id} value={i.id}>
				{i.name}
				{i.archived ? ' (archived)' : ''}
			</option>
		))

	return (
		<select
			aria-label={label}
			className={invalid ? 'invalid' : undefined}
			value={value ?? ''}
			onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
		>
			<option value="">{placeholder}</option>
			{grouped
				? (Object.keys(groupLabels) as ManagementCategoryGroup[]).map(group => {
						const inGroup = visible.filter(i => i.group === group)
						return inGroup.length ? (
							<optgroup key={group} label={groupLabels[group]}>
								{options(inGroup)}
							</optgroup>
						) : null
					})
				: options(visible)}
		</select>
	)
}
