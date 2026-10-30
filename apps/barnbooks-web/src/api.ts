import type {
	Account,
	Enterprise,
	ManagementCategory,
	ManagementCategoryGroup,
	PnlRole,
	SquareCategory,
	Transaction as DbTransaction,
	TransactionStatus,
	TransactionType,
	Vendor,
} from '@tdf-mono/db-client'

// JSON turns Dates into strings.
type Wire<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] }

export type { Account, Enterprise, ManagementCategory, ManagementCategoryGroup, PnlRole, SquareCategory, TransactionStatus, TransactionType, Vendor }
export type Transaction = Wire<DbTransaction>

export interface Lookups {
	accounts: Account[]
	transactionTypes: TransactionType[]
	managementCategories: ManagementCategory[]
	enterprises: Enterprise[]
	vendors: Vendor[]
	squareCategories: SquareCategory[]
}

export type TransactionEdit = Partial<
	Pick<
		Transaction,
		| 'date'
		| 'account_id'
		| 'transaction_type_id'
		| 'vendor_id'
		| 'management_category_id'
		| 'enterprise_id'
		| 'amount'
		| 'description'
	>
>

export class ApiError extends Error {
	constructor(
		message: string,
		readonly details?: { rowErrors?: { line: number; message: string }[] },
	) {
		super(message)
	}
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	const res = await fetch(`/api${path}`, {
		method,
		headers: body === undefined ? undefined : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	if (res.status === 204) return undefined as T
	const data = await res.json().catch(() => ({}))
	if (!res.ok) {
		const reason = data.issues?.[0]?.message
		throw new ApiError(`${data.error ?? `Request failed (${res.status})`}${reason ? `: ${reason}` : ''}`, data)
	}
	return data as T
}

// POST /api/imports/square (see apps/api/src/import/importSquare.ts). Amounts in cents.
export interface SquareImport {
	from: string
	to: string
	accountId: number
	categories: { name: string; netCents: number; managementCategoryId: number | null; enterpriseId: number | null; isNew: boolean }[]
	summary: { grossCents: number; netCents: number; taxCents: number; cardCents: number; cashCents: number; feesCents: number; netTotalCents: number } | null
	warnings: string[]
	// Set when this range overlaps an earlier Square import; importing is refused.
	overlap: string | null
	payouts: { id: number; date: string; accountId: number; description: string; cents: number; likely: boolean }[]
	expectedPayoutCents: number | null
	imported: number
	batchId: number | null
}

// GET /api/reports/pnl (see apps/api/src/reports/pnl.ts). Amounts are in cents; money out is negative.
export interface PnlLine {
	label: string
	values: number[]
	total: number
	// The transactions behind the line, for opening them in the ledger.
	link?: { role: PnlRole; categoryId?: number | null; typeId?: number }
}
export interface PnlPercentLine {
	label: string
	values: (number | null)[]
	total: number | null
}
export interface PnlSection {
	title: string
	lines: PnlLine[]
	total: PnlLine
}
export type PnlPeriod = 'month' | 'year'
export interface PnlReport {
	period: PnlPeriod
	year: number | null
	availableYears: number[]
	columns: { key: string; label: string }[]
	revenue: PnlSection
	directCosts: PnlSection
	grossMargin: PnlLine
	grossMarginPct: PnlPercentLine
	sellingCosts: PnlSection
	overhead: PnlSection
	operatingProfit: PnlLine
	profitMarginPct: PnlPercentLine
	capex: PnlSection
	otherCashMovements: PnlSection
}

export const api = {
	lookups: () => request<Lookups>('GET', '/lookups'),

	pnl: (period: PnlPeriod, year?: number) =>
		request<PnlReport>('GET', `/reports/pnl?${new URLSearchParams({ period, ...(year ? { year: String(year) } : {}) })}`),

	transactions: (status: TransactionStatus, params: { from?: string; to?: string } = {}) => {
		const qs = new URLSearchParams({ status, ...params })
		return request<Transaction[]>('GET', `/transactions?${qs}`)
	},
	createTransaction: (body: TransactionEdit) => request<Transaction>('POST', '/transactions', body),
	updateTransaction: (id: number, body: TransactionEdit) => request<Transaction>('PATCH', `/transactions/${id}`, body),
	// Imported drafts come back in `dismissed` (restorable); manual drafts come back in `deleted`.
	deleteTransactions: (ids: number[]) =>
		request<{ dismissed: number[]; deleted: number[] }>('POST', '/transactions/delete', { ids }),
	restoreTransactions: (ids: number[]) => request<{ restored: number }>('POST', '/transactions/restore', { ids }),
	postTransactions: (ids: number[]) =>
		request<{ posted: number; incomplete: number[] }>('POST', '/transactions/post', { ids }),
	unpostTransaction: (id: number) => request<Transaction>('POST', `/transactions/${id}/unpost`),
	rematchDrafts: () => request<{ matched: number }>('POST', '/transactions/rematch-drafts'),

	importCsv: (body: { accountId: number; filename: string; csv: string }) =>
		request<{ batchId: number | null; imported: number; duplicates: number }>('POST', '/imports', body),

	importSquare: (body: { files: { filename: string; csv: string }[]; from?: string; to?: string; preview: boolean }) =>
		request<SquareImport>('POST', '/imports/square', body),
	retypeSquarePayouts: (ids: number[]) => request<{ retyped: number }>('POST', '/imports/square/retype-payouts', { ids }),

	createLookup: (kind: LookupKind, body: Record<string, unknown>) => request<unknown>('POST', `/${kind}`, body),
	updateLookup: (kind: LookupKind, id: number, body: Record<string, unknown>) =>
		request<unknown>('PATCH', `/${kind}/${id}`, body),
	deleteVendor: (id: number) => request<void>('DELETE', `/vendors/${id}`),
}

export type LookupKind = 'transaction-types' | 'management-categories' | 'enterprises' | 'vendors' | 'square-categories'

export const groupLabels: Record<ManagementCategoryGroup, string> = {
	income: 'Income',
	direct_production: 'Direct production',
	selling: 'Selling costs',
	overhead: 'Farm overhead',
	capital: 'Capital',
	non_operating: 'Non-operating',
}
