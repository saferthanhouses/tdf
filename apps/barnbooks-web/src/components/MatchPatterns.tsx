import { useState } from 'react'

// Editable list of match texts for a form; every keystroke goes to onChange.
export function MatchPatternsField({ value, onChange }: { value: string[]; onChange: (patterns: string[]) => void }) {
	const set = (i: number, text: string) => onChange(value.map((p, j) => (j === i ? text : p)))
	return (
		<div className="pattern-field">
			{value.map((pattern, i) => (
				<div key={i} className="pattern-field-row">
					<input
						aria-label={`Text to match ${i + 1}`}
						value={pattern}
						onChange={e => set(i, e.target.value)}
						required={i === 0}
						// autoFocus only fires on mount, i.e. for a row just added with "+ Add another spelling".
						autoFocus={i > 0}
					/>
					<button
						type="button"
						className="icon-button delete"
						aria-label="Remove match text"
						title="Remove"
						disabled={value.length === 1}
						onClick={() => onChange(value.filter((_, j) => j !== i))}
					>
						×
					</button>
				</div>
			))}
			<button type="button" className="link" onClick={() => onChange([...value, ''])}>
				+ Add another spelling
			</button>
		</div>
	)
}

// Match texts as removable chips plus an input to add more; each change is saved via onChange.
export function MatchPatternChips({ value, onChange }: { value: string[]; onChange: (patterns: string[]) => void }) {
	const [adding, setAdding] = useState('')
	const add = () => {
		const text = adding.trim()
		setAdding('')
		if (text && !value.some(p => p.toLowerCase() === text.toLowerCase())) onChange([...value, text])
	}
	return (
		<div className="pattern-chips">
			{value.map(pattern => (
				<span key={pattern} className="pattern-chip">
					{pattern}
					<button
						type="button"
						aria-label={`Remove “${pattern}”`}
						title={value.length === 1 ? 'A vendor needs at least one match text' : 'Remove'}
						disabled={value.length === 1}
						onClick={() => onChange(value.filter(p => p !== pattern))}
					>
						×
					</button>
				</span>
			))}
			<input
				className="pattern-chip-input"
				aria-label="Add match text"
				placeholder="+ add"
				value={adding}
				onChange={e => setAdding(e.target.value)}
				onBlur={add}
				onKeyDown={e => {
					if (e.key === 'Enter') {
						e.preventDefault()
						add()
					}
				}}
			/>
		</div>
	)
}
