import { useEffect, useState } from 'react'
import { api, type PnlLine, type PnlPercentLine, type PnlPeriod, type PnlReport, type PnlSection } from '../api'
import { formatMoney } from '../format'
import { defaultSort, emptyFilters, writeLedgerParams, type LedgerFilters } from '../ledgerView'

// Ledger URL showing exactly the transactions behind one P&L number: same role and category (or type), same
// period. The Total column is the year (monthly view) or all time (yearly view).
type HrefFor = (line: PnlLine, column: number | 'total') => string | undefined
function makeHrefFor(report: PnlReport): HrefFor {
	return (line, column) => {
		if (!line.link) return undefined
		const period = column === 'total' ? (report.period === 'month' ? String(report.year) : '') : report.columns[column]!.key
		const filters: LedgerFilters = {
			...emptyFilters,
			role: line.link.role,
			category: line.link.categoryId === undefined ? null : (line.link.categoryId ?? 'none'),
			type: line.link.typeId ?? null,
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
	const [period, setPeriod] = useState<PnlPeriod>('month')
	const [year, setYear] = useState<number | undefined>()
	const [report, setReport] = useState<PnlReport | null>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let current = true
		api
			.pnl(period, period === 'month' ? year : undefined)
			.then(r => {
				if (!current) return
				setReport(r)
				setError(null)
				if (r.year !== null) setYear(r.year)
			})
			.catch(e => current && setError((e as Error).message))
		return () => {
			current = false
		}
	}, [period, year])

	const width = report ? report.columns.length + 2 : 1
	const hrefFor = report ? makeHrefFor(report) : () => undefined

	return (
		<section className="pnl">
			<div className="toolbar">
				<h2>Profit &amp; loss</h2>
				<div className="spacer" />
				<div className="segmented" role="group" aria-label="Period">
					<button className={period === 'month' ? 'active' : undefined} onClick={() => setPeriod('month')}>
						Monthly
					</button>
					<button className={period === 'year' ? 'active' : undefined} onClick={() => setPeriod('year')}>
						Yearly
					</button>
				</div>
				{period === 'month' && report && (
					<label>
						Year{' '}
						<select value={year ?? ''} onChange={e => setYear(Number(e.target.value))}>
							{(report.availableYears.includes(year ?? -1) ? report.availableYears : [year!, ...report.availableYears])
								.filter(Boolean)
								.map(y => (
									<option key={y} value={y}>
										{y}
									</option>
								))}
						</select>
					</label>
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
							<Section hrefFor={hrefFor} section={report.revenue} width={width} />
							<Section hrefFor={hrefFor} section={report.directCosts} width={width} />
							<Line line={report.grossMargin} kind="result" />
							<PercentLine line={report.grossMarginPct} />
							<Spacer width={width} />
							<Section hrefFor={hrefFor} section={report.sellingCosts} width={width} />
							<Section hrefFor={hrefFor} section={report.overhead} width={width} />
							<Line line={report.operatingProfit} kind="result strong" />
							<PercentLine line={report.profitMarginPct} />
							<Spacer width={width} />
							<Section hrefFor={hrefFor} section={report.capex} width={width} />
							<Spacer width={width} />
							<Section hrefFor={hrefFor} section={report.otherCashMovements} width={width} />
						</tbody>
					</table>
				</div>
			)}
			<p className="muted pnl-note">
				Posted transactions only. Revenue and expenses come from transaction types counted as “revenue / expense”,
				placed by their category’s group; capital expenditure from types counted as “capital expenditure”. Both are
				set on the Categories &amp; vendors tab.
			</p>
		</section>
	)
}

function Section({ section, width, hrefFor }: { section: PnlSection; width: number; hrefFor: HrefFor }) {
	return (
		<>
			<tr className="pnl-section">
				<th colSpan={width}>{section.title}</th>
			</tr>
			{section.lines.length === 0 ? (
				<tr>
					<td className="muted" colSpan={width}>
						None
					</td>
				</tr>
			) : (
				section.lines.map(line => <Line key={line.label} line={line} hrefFor={hrefFor} />)
			)}
			<Line line={section.total} kind="total" hrefFor={hrefFor} />
		</>
	)
}

function Line({ line, kind, hrefFor }: { line: PnlLine; kind?: string; hrefFor?: HrefFor }) {
	const cell = (cents: number, column: number | 'total') => {
		const href = cents !== 0 ? hrefFor?.(line, column) : undefined
		return href ? (
			<a className="pnl-link" href={href} onClick={openInLedger} title={`Show these transactions in the ledger`}>
				{money(cents)}
			</a>
		) : (
			money(cents)
		)
	}
	return (
		<tr className={kind ? `pnl-${kind.split(' ').join(' pnl-')}` : undefined}>
			<td>{line.label}</td>
			{line.values.map((v, i) => (
				<td key={i} className={`num${v < 0 ? ' out' : ''}`}>
					{cell(v, i)}
				</td>
			))}
			<td className={`num pnl-row-total${line.total < 0 ? ' out' : ''}`}>{cell(line.total, 'total')}</td>
		</tr>
	)
}

function PercentLine({ line }: { line: PnlPercentLine }) {
	return (
		<tr className="pnl-percent">
			<td>{line.label}</td>
			{line.values.map((v, i) => (
				<td key={i} className="num">
					{pct(v)}
				</td>
			))}
			<td className="num pnl-row-total">{pct(line.total)}</td>
		</tr>
	)
}

const Spacer = ({ width }: { width: number }) => (
	<tr className="pnl-spacer">
		<td colSpan={width} />
	</tr>
)
