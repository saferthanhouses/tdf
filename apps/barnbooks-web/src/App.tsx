import { useCallback, useEffect, useState } from 'react'
import { LookupsProvider } from './lookups'
import { DraftsPage } from './components/DraftsPage'
import { LedgerPage } from './components/LedgerPage'
import { PnlPage } from './components/PnlPage'
import { PnlLayoutsPage } from './components/PnlLayoutsPage'
import { CategoriesPage } from './components/CategoriesPage'
import { NavMenu } from './components/NavMenu'

// Page ids are also the URL hash (#ledger), so bookmarks and links between pages keep working.
const pages = {
	drafts: 'Drafts',
	ledger: 'Ledger',
	pnl: 'Profit & loss',
	'pnl-layouts': 'P&L layouts',
	categories: 'Categories & vendors',
} as const
type Page = keyof typeof pages

type NavEntry = { menu: string; pages: Page[] } | { page: Page }
const nav: NavEntry[] = [
	{ menu: 'Transactions', pages: ['drafts', 'ledger'] },
	{ menu: 'Reports', pages: ['pnl', 'pnl-layouts'] },
	{ page: 'categories' },
]

const pageFromHash = (): Page | null => {
	const p = window.location.hash.slice(1)
	return p in pages ? (p as Page) : null
}

export function App() {
	const [page, setPageState] = useState<Page>(() => pageFromHash() ?? 'drafts')
	const [openMenu, setOpenMenu] = useState<string | null>(null)

	const setPage = (p: Page) => {
		setPageState(p)
		window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${p}`)
	}
	// Follow the URL when it changes underneath us: hash edits (typing #pnl), and Back/Forward. Back from a
	// P&L link to the ledger changes the query string too, which browsers report as popstate, not hashchange.
	useEffect(() => {
		const onUrl = () => {
			const p = pageFromHash()
			if (p) setPageState(p)
			setOpenMenu(null)
		}
		window.addEventListener('hashchange', onUrl)
		window.addEventListener('popstate', onUrl)
		return () => {
			window.removeEventListener('hashchange', onUrl)
			window.removeEventListener('popstate', onUrl)
		}
	}, [])

	// Opening a menu closes any other; closing only affects that menu.
	const menuOpenChange = useCallback(
		(menu: string) => (open: boolean) => setOpenMenu(current => (open ? menu : current === menu ? null : current)),
		[],
	)

	return (
		<>
			<header className="app-header">
				<h1>Barnbooks</h1>
				<nav aria-label="Main">
					{nav.map(entry =>
						'menu' in entry ? (
							<NavMenu
								key={entry.menu}
								label={entry.menu}
								items={entry.pages.map(p => ({ page: p, label: pages[p] }))}
								current={page}
								open={openMenu === entry.menu}
								onOpenChange={menuOpenChange(entry.menu)}
								onSelect={setPage}
							/>
						) : (
							<button
								key={entry.page}
								className={entry.page === page ? 'tab active' : 'tab'}
								aria-current={entry.page === page ? 'page' : undefined}
								onClick={() => {
									setOpenMenu(null)
									setPage(entry.page)
								}}
							>
								{pages[entry.page]}
							</button>
						),
					)}
				</nav>
			</header>
			<main>
				<LookupsProvider refreshKey={page}>
					{page === 'drafts' && <DraftsPage />}
					{page === 'ledger' && <LedgerPage />}
					{page === 'pnl' && <PnlPage />}
					{page === 'pnl-layouts' && <PnlLayoutsPage />}
					{page === 'categories' && <CategoriesPage />}
				</LookupsProvider>
			</main>
		</>
	)
}
