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
	// Follow hash edits too (typing #pnl, or pasting a link while the app is open).
	useEffect(() => {
		const onHash = () => {
			const t = window.location.hash.slice(1)
			if (t in tabs) setTabState(t as Tab)
		}
		window.addEventListener('hashchange', onHash)
		return () => window.removeEventListener('hashchange', onHash)
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
