import { useEffect, useId, useRef, type KeyboardEvent } from 'react'

export interface NavMenuItem<P extends string> {
	page: P
	label: string
}

// A header menu: a trigger button that opens a list of pages. The parent owns which menu is open, so
// opening one closes the others. Closes on choosing a page, clicking outside, or Escape (which also
// returns focus to the trigger). Arrow keys, Home and End move between items.
export function NavMenu<P extends string>({
	label,
	items,
	current,
	open,
	onOpenChange,
	onSelect,
}: {
	label: string
	items: NavMenuItem<P>[]
	current: P
	open: boolean
	onOpenChange: (open: boolean) => void
	onSelect: (page: P) => void
}) {
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const listRef = useRef<HTMLDivElement>(null)
	const menuId = useId()
	const active = items.some(i => i.page === current)

	// Focus the current page's item (or the first) when the menu opens.
	useEffect(() => {
		if (!open) return
		const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
		;(buttons.find(b => b.getAttribute('aria-current') === 'page') ?? buttons[0])?.focus()
	}, [open])

	useEffect(() => {
		if (!open) return
		const onPointer = (e: PointerEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false)
		}
		document.addEventListener('pointerdown', onPointer)
		return () => document.removeEventListener('pointerdown', onPointer)
	}, [open, onOpenChange])

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key === 'Escape') {
			e.preventDefault()
			onOpenChange(false)
			triggerRef.current?.focus()
			return
		}
		const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
		const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
		const move: Record<string, number | undefined> = {
			ArrowDown: (i + 1) % buttons.length,
			ArrowUp: (i - 1 + buttons.length) % buttons.length,
			Home: 0,
			End: buttons.length - 1,
		}
		const next = move[e.key]
		if (next !== undefined && buttons.length) {
			e.preventDefault()
			buttons[next]?.focus()
		}
	}

	return (
		<div className="nav-menu" ref={rootRef}>
			<button
				ref={triggerRef}
				className={`tab nav-trigger${active ? ' active' : ''}`}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				onClick={() => onOpenChange(!open)}
				onKeyDown={e => {
					if (e.key === 'ArrowDown' && !open) {
						e.preventDefault()
						onOpenChange(true)
					}
				}}
			>
				{label}
				<span className="nav-caret" aria-hidden="true">
					▾
				</span>
			</button>
			{open && (
				<div className="nav-menu-list" role="menu" id={menuId} aria-label={label} ref={listRef} onKeyDown={onKeyDown}>
					{items.map(item => (
						<button
							key={item.page}
							role="menuitem"
							aria-current={item.page === current ? 'page' : undefined}
							onClick={() => {
								onSelect(item.page)
								onOpenChange(false)
								// Keep keyboard users' place in the header rather than dropping focus to the page.
								triggerRef.current?.focus()
							}}
						>
							<span className="nav-check" aria-hidden="true">
								{item.page === current ? '✓' : ''}
							</span>
							{item.label}
						</button>
					))}
				</div>
			)}
		</div>
	)
}
