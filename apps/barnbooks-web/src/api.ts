import type {
	Account,
	Enterprise,
	ManagementCategory,
	ManagementCategoryGroup,
	Transaction as DbTransaction,
	TransactionStatus,
	TransactionType,
	Vendor,
} from '@tdf-mono/db-client'

// JSON turns Dates into strings.
type Wire<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] }

export type { Account, Enterprise, ManagementCategory, ManagementCategoryGroup, TransactionStatus, TransactionType, Vendor }
export type Transaction = Wire<DbTransaction>

export interface Lookups {
	accounts: Account[]
	transactionTypes: TransactionType[]
	managementCategories: ManagementCategory[]
	enterprises: Enterprise[]
	vendors: Vendor[]
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
	if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, data)
	return data as T
}

export const api = {
	lookups: () => request<Lookups>('GET', '/lookups'),

	transactions: (status: TransactionStatus, params: { from?: string; to?: string } = {}) => {
		const qs = new URLSearchParams({ status, ...params })
		return request<Transaction[]>('GET', `/transactions?${qs}`)
	},
	createTransaction: (body: TransactionEdit) => request<Transaction>('POST', '/transactions', body),
	updateTransaction: (id: number, body: TransactionEdit) => request<Transaction>('PATCH', `/transactions/${id}`, body),
	deleteTransaction: (id: number) => request<void>('DELETE', `/transactions/${id}`),
	postTransactions: (ids: number[]) =>
		request<{ posted: number; incomplete: number[] }>('POST', '/transactions/post', { ids }),
	unpostTransaction: (id: number) => request<Transaction>('POST', `/transactions/${id}/unpost`),
	rematchDrafts: () => request<{ matched: number }>('POST', '/transactions/rematch-drafts'),

	importCsv: (body: { accountId: number; filename: string; csv: string }) =>
		request<{ batchId: number | null; imported: number; duplicates: number }>('POST', '/imports', body),

	createLookup: (kind: LookupKind, body: Record<string, unknown>) => request<unknown>('POST', `/${kind}`, body),
	updateLookup: (kind: LookupKind, id: number, body: Record<string, unknown>) =>
		request<unknown>('PATCH', `/${kind}/${id}`, body),
	deleteVendor: (id: number) => request<void>('DELETE', `/vendors/${id}`),
}

export type LookupKind = 'transaction-types' | 'management-categories' | 'enterprises' | 'vendors'

export const groupLabels: Record<ManagementCategoryGroup, string> = {
	income: 'Income',
	direct_production: 'Direct production',
	selling: 'Selling costs',
	overhead: 'Farm overhead',
	capital: 'Capital',
	non_operating: 'Non-operating',
}
