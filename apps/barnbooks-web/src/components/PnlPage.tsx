import { useEffect, useState } from 'react'
import { api, type PnlLine, type PnlPercentLine, type PnlPeriod, type PnlReport, type PnlSection } from '../api'
import { formatMoney } from '../format'

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
							<Section section={report.revenue} width={width} />
							<Section section={report.directCosts} width={width} />
							<Line line={report.grossMargin} kind="result" />
							<PercentLine line={report.grossMarginPct} />
							<Spacer width={width} />
							<Section section={report.sellingCosts} width={width} />
							<Section section={report.overhead} width={width} />
							<Line line={report.operatingProfit} kind="result strong" />
							<PercentLine line={report.profitMarginPct} />
							<Spacer width={width} />
							<Section section={report.capex} width={width} />
							<Spacer width={width} />
							<Section section={report.otherCashMovements} width={width} />
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

function Section({ section, width }: { section: PnlSection; width: number }) {
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
				section.lines.map(line => <Line key={line.label} line={line} />)
			)}
			<Line line={section.total} kind="total" />
		</>
	)
}

function Line({ line, kind }: { line: PnlLine; kind?: string }) {
	return (
		<tr className={kind ? `pnl-${kind.split(' ').join(' pnl-')}` : undefined}>
			<td>{line.label}</td>
			{line.values.map((v, i) => (
				<td key={i} className={`num${v < 0 ? ' out' : ''}`}>
					{money(v)}
				</td>
			))}
			<td className={`num pnl-row-total${line.total < 0 ? ' out' : ''}`}>{money(line.total)}</td>
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
