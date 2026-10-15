import { useEffect, useState } from 'react'

// Saves on blur or Enter rather than on every keystroke. If `parse` returns null the edit is reverted.
export function CommitInput({
	value,
	onCommit,
	parse = v => v,
	placeholder,
	className,
}: {
	value: string
	onCommit: (value: string) => void
	parse?: (value: string) => string | null
	placeholder?: string
	className?: string
}) {
	const [draft, setDraft] = useState(value)
	useEffect(() => setDraft(value), [value])
	const commit = () => {
		const parsed = parse(draft)
		if (parsed === null) setDraft(value)
		else if (parsed !== value) onCommit(parsed)
	}
	return (
		<input
			className={className}
			value={draft}
			placeholder={placeholder}
			onChange={e => setDraft(e.target.value)}
			onBlur={commit}
			onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
		/>
	)
}
