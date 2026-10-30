import type { ColumnType, Generated } from 'kysely'

export type ManagementCategoryGroup =
	| 'direct_production'
	| 'selling'
	| 'overhead'
	| 'capital'
	| 'income'
	| 'non_operating'

export type TransactionStatus = 'draft' | 'posted' | 'dismissed'

// Lookup tables are editable from the UI, so values live in the database rather than in TS unions.
export interface TransactionTypeTable {
	id: Generated<number>
	name: string
	archived: Generated<boolean>
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

// P&L layouts: saved report definitions (see migrations/1793500000000_pnl_layouts.ts).
export type PnlRowKind = 'heading' | 'lines' | 'total' | 'percent' | 'spacer'
export type PnlSplit = 'none' | 'category' | 'enterprise' | 'type'

export interface PnlLayoutTable {
	id: Generated<number>
	name: string
	position: Generated<number>
}

export interface PnlRowTable {
	id: Generated<number>
	layout_id: number
	position: number
	kind: PnlRowKind
	label: Generated<string>
	// lines: posted transactions matching every non-empty list
	type_ids: Generated<number[]>
	category_ids: Generated<number[]>
	category_groups: ColumnType<ManagementCategoryGroup[], ManagementCategoryGroup[] | undefined, ManagementCategoryGroup[]>
	enterprise_ids: Generated<number[]>
	account_ids: Generated<number[]>
	split_by: Generated<PnlSplit>
	total_label: string | null
	// total: sum of these rows
	sum_row_ids: Generated<number[]>
	emphasis: Generated<boolean>
	// percent: numerator as a percentage of denominator
	numerator_row_id: number | null
	denominator_row_id: number | null
}
