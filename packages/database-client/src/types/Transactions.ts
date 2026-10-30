import type { ColumnType, Generated } from 'kysely'

export type ManagementCategoryGroup =
	| 'direct_production'
	| 'selling'
	| 'overhead'
	| 'capital'
	| 'income'
	| 'non_operating'

export type TransactionStatus = 'draft' | 'posted' | 'dismissed'

// How a transaction type counts in the P&L: operating (by category section), capex (its own row), or other
// (excluded from profit, listed as other cash movements).
export type PnlRole = 'operating' | 'capex' | 'other'

// Lookup tables are editable from the UI, so values live in the database rather than in TS unions.
export interface TransactionTypeTable {
	id: Generated<number>
	name: string
	archived: Generated<boolean>
	pnl_role: Generated<PnlRole>
}

export interface ManagementCategoryTable {
	id: Generated<number>
	name: string
	group: ManagementCategoryGroup
	archived: Generated<boolean>
}

export interface EnterpriseTable {
	id: Generated<number>
	name: string
	archived: Generated<boolean>
}

export interface VendorTable {
	id: Generated<number>
	name: string
	// Case-insensitive substrings matched against the bank description; the longest match across all vendors wins.
	match_patterns: string[]
	default_transaction_type_id: number | null
	default_management_category_id: number | null
	default_enterprise_id: number | null
}

export interface ImportBatchTable {
	id: Generated<number>
	account_id: number
	filename: string | null
	imported_at: ColumnType<Date, Date | string | undefined, never>
	// The date range a Square summary import covers ('YYYY-MM-DD'); null for bank imports.
	period_from: string | null
	period_to: string | null
}

// A Square item category and where its sales go. Created on first import; mapped on the Categories page.
export interface SquareCategoryTable {
	id: Generated<number>
	name: string
	management_category_id: number | null
	enterprise_id: number | null
	archived: Generated<boolean>
}

export interface TransactionTable {
	id: Generated<number>
	status: Generated<TransactionStatus>
	// DATE is returned as a 'YYYY-MM-DD' string (see the pg type parser in src/index.ts).
	date: string
	account_id: number
	transaction_type_id: number | null
	vendor_id: number | null
	management_category_id: number | null
	enterprise_id: number | null
	// NUMERIC is returned as a string by pg to avoid float rounding.
	amount: ColumnType<string, string | number, string | number>
	description: Generated<string>
	raw_description: string | null
	import_batch_id: number | null
	dedupe_hash: string | null
	created_at: ColumnType<Date, Date | string | undefined, never>
	posted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>
}
