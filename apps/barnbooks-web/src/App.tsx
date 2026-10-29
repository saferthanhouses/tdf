import { useEffect, useState } from 'react'
import { LookupsProvider } from './lookups'
import { DraftsPage } from './components/DraftsPage'
import { LedgerPage } from './components/LedgerPage'
import { PnlPage } from './components/PnlPage'
import { CategoriesPage } from './components/CategoriesPage'

const tabs = { drafts: 'Drafts', ledger: 'Ledger', pnl: 'P&L', categories: 'Categories & vendors' } as const
type Tab = keyof typeof tabs

export function App() {
	// The tab lives in the URL hash (#ledger) so a reload stays on it.
	const [tab, setTabState] = useState<Tab>(() => {
		const fromHash = window.location.hash.slice(1)
		return fromHash in tabs ? (fromHash as Tab) : 'drafts'
	})
	const setTab = (t: Tab) => {
		setTabState(t)
		window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${t}`)
	}
	// Follow the URL when it changes underneath us: hash edits (typing #pnl), and Back/Forward. Back from a
	// P&L link to the ledger changes the query string too, which browsers report as popstate, not hashchange.
	useEffect(() => {
		const onUrl = () => {
			const t = window.location.hash.slice(1)
			if (t in tabs) setTabState(t as Tab)
		}
		window.addEventListener('hashchange', onUrl)
		window.addEventListener('popstate', onUrl)
		return () => {
			window.removeEventListener('hashchange', onUrl)
			window.removeEventListener('popstate', onUrl)
		}
	}, [])

	return (
		<>
			<header className="app-header">
				<h1>Barnbooks</h1>
				<nav>
					{(Object.keys(tabs) as Tab[]).map(t => (
						<button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
							{tabs[t]}
						</button>
					))}
				</nav>
			</header>
			<main>
				<LookupsProvider refreshKey={tab}>
					{tab === 'drafts' && <DraftsPage />}
					{tab === 'ledger' && <LedgerPage />}
					{tab === 'pnl' && <PnlPage />}
					{tab === 'categories' && <CategoriesPage />}
				</LookupsProvider>
			</main>
		</>
	)
}
