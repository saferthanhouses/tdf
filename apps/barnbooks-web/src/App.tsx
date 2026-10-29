import { useState } from 'react'
import { LookupsProvider } from './lookups'
import { DraftsPage } from './components/DraftsPage'
import { LedgerPage } from './components/LedgerPage'
import { PnlPage } from './components/PnlPage'
import { CategoriesPage } from './components/CategoriesPage'

const tabs = { drafts: 'Drafts', ledger: 'Ledger', pnl: 'P&L', categories: 'Categories & vendors' } as const
type Tab = keyof typeof tabs

export function App() {
	const [tab, setTab] = useState<Tab>('drafts')

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
