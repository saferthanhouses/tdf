import { useEffect, useState } from 'react'
import { api, type PnlColumnsBy, type PnlLink, type PnlRenderedRow, type PnlReport } from '../api'
import { formatMoney } from '../format'
import { defaultSort, emptyFilters, isPeriod, writeLedgerParams, type LedgerFilters } from '../ledgerView'

// What the report shows, kept in the URL so a reload or bookmark keeps it.
interface PnlView {
	layout?: number
	columns: PnlColumnsBy
	year?: number // monthly columns
	period?: string // enterprise/category columns: 'YYYY', 'YYYY-MM' or '' (all time)
}
const COLUMN_OPTIONS: { value: PnlColumnsBy; label: string }[] = [
	{ value: 'month', label: 'Monthly' },
	{ value: 'year', label: 'Yearly' },
	{ value: 'enterprise', label: 'By enterprise' },
	{ value: 'category', label: 'By category' },
]

function readView(search: string): PnlView {
	const p = new URLSearchParams(search)
	const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : undefined)
	const columns = COLUMN_OPTIONS.find(o => o.value === p.get('columns'))?.value ?? 'month'
	const period = p.get('period')
	return { layout: num(p.get('layout')), columns, year: num(p.get('year')), period: period !== null && (period === '' || isPeriod(period)) ? period : undefined }
}

function writeView(v: PnlView): string {
	const p = new URLSearchParams()
	if (v.layout) p.set('layout', String(v.layout))
	if (v.columns !== 'month') p.set('columns', v.columns)
	if (v.columns === 'month' && v.year) p.set('year', String(v.year))
	if ((v.columns === 'enterprise' || v.columns === 'category') && v.period !== undefined) p.set('period', v.period)
	const s = p.toString()
	return s ? `?${s}` : ''
}

// Ledger URL showing exactly the transactions behind one P&L number: the layout row (and split value), the
// column's period, and for enterprise/category columns that enterprise or category. The Total column is the
// whole range the report covers.
type HrefFor = (link: PnlLink | undefined, column: number | 'total') => string | undefined
function makeHrefFor(report: PnlReport): HrefFor {
	return (link, column) => {
		if (!link) return undefined
		const filters: LedgerFilters = { ...emptyFilters, pnlRow: link.row, pnlSplit: link.split ?? null }
		let period: string
		if (report.columnsBy === 'month') period = column === 'total' ? String(report.year) : report.columns[column]!.key
		else if (report.columnsBy === 'year') period = column === 'total' ? '' : report.columns[column]!.key
		else {
			period = report.period ?? ''
			if (column !== 'total') {
				const key = report.columns[column]!.key
				filters[report.columnsBy] = key === 'none' ? 'none' : Number(key)
			}
		}
		return `${window.location.pathname}${writeLedgerParams(filters, defaultSort, period)}#ledger`
	}
}

// Switch to the ledger in place (Back returns here); modified clicks open a new tab as usual.
function openInLedger(e: React.MouseEvent<HTMLAnchorElement>) {
	if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
	e.preventDefault()
	window.history.pushState(null, '', e.currentTarget.getAttribute('href'))
	window.dispatchEvent(new HashChangeEvent('hashchange'))
}

const money = (cents: number) => (cents === 0 ? <span className="muted">–</span> : formatMoney(cents / 100))
const pct = (v: number | null) => (v === null ? <span className="muted">–</span> : `${v.toFixed(1)}%`)

export function PnlPage() {
	const [view, setView] = useState<PnlView>(() => readView(window.location.search))
	const [report, setReport] = useState<PnlReport | null>(null)
	const [error, setError] = useState<string | null>(null)
	const update = (change: Partial<PnlView>) => setView(v => ({ ...v, ...change }))

	useEffect(() => {
		let current = true
		api
			.pnl(view)
			.then(r => {
				if (!current) return
				setReport(r)
				setError(null)
			})
			.catch(e => current && setError((e as Error).message))
		return () => {
			current = false
		}
	}, [view])

	// Keep the view in the URL; clear it when leaving the page.
	useEffect(() => {
		const { pathname, hash } = window.location
		window.history.replaceState(null, '', pathname + writeView(view) + hash)
	}, [view])
	useEffect(() => () => window.history.replaceState(null, '', window.location.pathname + window.location.hash), [])

	const width = report ? report.columns.length + 2 : 1
	const hrefFor = report ? makeHrefFor(report) : () => undefined
	const years = report?.availableYears ?? []
	const byList = view.columns === 'enterprise' || view.columns === 'category'

	return (
		<section className="pnl">
			<div className="toolbar">
				<h2>Profit &amp; loss</h2>
				{report && report.layouts.length > 1 && (
					<select aria-label="Layout" value={report.layout.id} onChange={e => update({ layout: Number(e.target.value) })}>
						{report.layouts.map(l => (
							<option key={l.id} value={l.id}>
								{l.name}
							</option>
						))}
					</select>
				)}
				<div className="spacer" />
				<div className="segmented" role="group" aria-label="Columns">
					{COLUMN_OPTIONS.map(o => (
						<button key={o.value} className={view.columns === o.value ? 'active' : undefined} onClick={() => update({ columns: o.value })}>
							{o.label}
						</button>
					))}
				</div>
				{view.columns === 'month' && report?.year && (
					<label>
						Year{' '}
						<select value={report.year} onChange={e => update({ year: Number(e.target.value) })}>
							{(years.includes(report.year) ? years : [report.year, ...years]).map(y => (
								<option key={y} value={y}>
									{y}
								</option>
							))}
						</select>
					</label>
				)}
				{byList && report && (
					<>
						<label>
							Period{' '}
							<select
								value={report.period !== null && report.period.length === 7 ? 'month' : (report.period ?? '')}
								onChange={e => update({ period: e.target.value === 'month' ? `${years[0] ?? new Date().getFullYear()}-01` : e.target.value })}
							>
								<option value="">All time</option>
								{years.map(y => (
									<option key={y} value={y}>
										{y}
									</option>
								))}
								<option value="month">A month…</option>
							</select>
						</label>
						{report.period?.length === 7 && (
							<input type="month" aria-label="Month" value={report.period} onChange={e => e.target.value && update({ period: e.target.value })} />
						)}
					</>
				)}
			</div>

			{error && <p className="error">{error}</p>}
			{!report ? (
				<p className="muted">Loading…</p>
			) : (
				<div className="table-wrap">
					<table className="pnl-table">
						<thead>
							<tr>
								<th />
								{report.columns.map(c => (
									<th key={c.key} className="num">
										{c.label}
									</th>
								))}
								<th className="num">Total</th>
							</tr>
						</thead>
						<tbody>
							{report.columns.length === 0 && byList ? (
								<tr>
									<td className="muted">No posted transactions in this period.</td>
								</tr>
							) : (
								report.rows.map((row, i) => <Row key={i} row={row} width={width} hrefFor={hrefFor} />)
							)}
						</tbody>
					</table>
				</div>
			)}
			<p className="muted pnl-note">
				Posted transactions only. Each line is the transactions matching the layout’s criteria (types, categories,
				enterprises, accounts); click a number to see them in the ledger.
			</p>
		</section>
	)
}

function Row({ row, width, hrefFor }: { row: PnlRenderedRow; width: number; hrefFor: HrefFor }) {
	switch (row.kind) {
		case 'section':
		case 'heading':
			return (
				<tr className="pnl-section">
					<th colSpan={width}>{row.label}</th>
				</tr>
			)
		case 'spacer':
			return (
				<tr className="pnl-spacer">
					<td colSpan={width} />
				</tr>
			)
		case 'empty':
			return (
				<tr>
					<td className="muted" colSpan={width}>
						None
					</td>
				</tr>
			)
		case 'percent':
			return (
				<tr className="pnl-percent">
					<td>{row.label}</td>
					{row.values.map((v, i) => (
						<td key={i} className="num">
							{pct(v)}
						</td>
					))}
					<td className="num pnl-row-total">{pct(row.total)}</td>
				</tr>
			)
		default: {
			const className = row.kind === 'subtotal' ? 'pnl-total' : row.kind === 'total' ? `pnl-result${row.emphasis ? ' pnl-strong' : ''}` : undefined
			const cell = (cents: number, column: number | 'total') => {
				const href = cents !== 0 ? hrefFor(row.link, column) : undefined
				return href ? (
					<a className="pnl-link" href={href} onClick={openInLedger} title="Show these transactions in the ledger">
						{money(cents)}
					</a>
				) : (
					money(cents)
				)
			}
			return (
				<tr className={className}>
					<td>{row.label}</td>
					{row.values.map((v, i) => (
						<td key={i} className={`num${v < 0 ? ' out' : ''}`}>
							{cell(v, i)}
						</td>
					))}
					<td className={`num pnl-row-total${row.total < 0 ? ' out' : ''}`}>{cell(row.total, 'total')}</td>
				</tr>
			)
		}
	}
}
