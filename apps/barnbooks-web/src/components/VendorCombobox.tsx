import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import type { Vendor } from '../api'

const MAX_SUGGESTIONS = 8

type Option =
	| { kind: 'bank'; text: string }
	| { kind: 'vendor'; vendor: Vendor }
	| { kind: 'create'; name: string }

// Free-text vendor field. Suggests the bank description first, then existing vendors.
// Text that isn't an existing vendor offers a "save as new vendor" option, handed to onCreate.
export function VendorCombobox({
	vendors,
	value,
	bankDescription,
	onSelect,
	onCreate,
}: {
	vendors: Vendor[]
	value: number | null
	bankDescription: string | null
	onSelect: (vendor: Vendor | null) => void
	onCreate: (name: string) => void
}) {
	const current = vendors.find(v => v.id === value)
	const [text, setText] = useState(current?.name ?? '')
	const [open, setOpen] = useState(false)
	const [active, setActive] = useState(0)
	const [position, setPosition] = useState<CSSProperties>({})
	const inputRef = useRef<HTMLInputElement>(null)
	const listId = useId()

	useEffect(() => setText(current?.name ?? ''), [current?.name])

	const query = text.trim().toLowerCase()
	const isCurrent = current !== undefined && text === current.name
	// Once something is typed, show vendors containing it; an unchanged field shows them all.
	const matches = vendors
		.filter(v => isCurrent || !query || v.name.toLowerCase().includes(query))
		.slice(0, MAX_SUGGESTIONS)
	const exact = vendors.find(v => v.name.toLowerCase() === query)

	const options: Option[] = [
		...(bankDescription && text !== bankDescription ? [{ kind: 'bank' as const, text: bankDescription }] : []),
		...(query && !exact ? [{ kind: 'create' as const, name: text.trim() }] : []),
		...matches.map(vendor => ({ kind: 'vendor' as const, vendor })),
	]

	// The table scrolls horizontally, so the list is positioned against the viewport to avoid being clipped.
	const openList = () => {
		const rect = inputRef.current?.getBoundingClientRect()
		if (rect) setPosition({ top: rect.bottom + 2, left: rect.left, minWidth: Math.max(rect.width, 280) })
		setActive(0)
		setOpen(true)
	}

	useEffect(() => {
		if (!open) return
		const close = () => setOpen(false)
		window.addEventListener('scroll', close, true)
		window.addEventListener('resize', close)
		return () => {
			window.removeEventListener('scroll', close, true)
			window.removeEventListener('resize', close)
		}
	}, [open])

	const choose = (option: Option) => {
		if (option.kind === 'bank') {
			// Fill the field and keep the list open so the "save as new vendor" option is right there.
			setText(option.text)
			setActive(0)
			return
		}
		setOpen(false)
		if (option.kind === 'vendor') {
			setText(option.vendor.name)
			if (option.vendor.id !== value) onSelect(option.vendor)
		} else {
			// Blur first so the dialog doesn't hand focus back here on close and reopen the list.
			inputRef.current?.blur()
			onCreate(option.name)
		}
	}

	// Leaving the field commits an exact vendor match or a cleared field; unsaved new names are discarded.
	const commitOnBlur = () => {
		setOpen(false)
		if (!query) {
			if (value !== null) onSelect(null)
			setText('')
		} else if (exact) {
			setText(exact.name)
			if (exact.id !== value) onSelect(exact)
		} else {
			setText(current?.name ?? '')
		}
	}

	return (
		<div className="combobox">
			<input
				ref={inputRef}
				role="combobox"
				aria-label="Vendor"
				aria-expanded={open}
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
				placeholder="Vendor"
				value={text}
				onFocus={openList}
				onBlur={commitOnBlur}
				onChange={e => {
					setText(e.target.value)
					if (!open) openList()
					setActive(0)
				}}
				onKeyDown={e => {
					if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
						e.preventDefault()
						if (!open) return openList()
						const step = e.key === 'ArrowDown' ? 1 : -1
						setActive(a => (a + step + options.length) % Math.max(options.length, 1))
					} else if (e.key === 'Enter' && open && options[active]) {
						e.preventDefault()
						choose(options[active]!)
					} else if (e.key === 'Escape') {
						setText(current?.name ?? '')
						setOpen(false)
					}
				}}
			/>
			{open && options.length > 0 && (
				<ul id={listId} role="listbox" className="combobox-list" style={position}>
					{options.map((option, i) => (
						<li
							key={option.kind === 'vendor' ? `v${option.vendor.id}` : option.kind}
							id={`${listId}-${i}`}
							role="option"
							aria-selected={i === active}
							className={`combobox-option ${option.kind}${i === active ? ' active' : ''}`}
							// Keep focus in the input so blur doesn't fire before the click lands.
							onMouseDown={e => e.preventDefault()}
							onMouseEnter={() => setActive(i)}
							onClick={() => choose(option)}
						>
							{option.kind === 'bank' && (
								<>
									<span className="combobox-hint">Bank description</span>
									{option.text}
								</>
							)}
							{option.kind === 'create' && (
								<>
									<span className="combobox-hint">Save as new vendor</span>+ “{option.name}”
								</>
							)}
							{option.kind === 'vendor' && option.vendor.name}
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
