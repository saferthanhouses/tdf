import type { Generated, Insertable, Selectable, Updateable } from 'kysely'
import type {
	EnterpriseTable,
	ImportBatchTable,
	ManagementCategoryTable,
	SquareCategoryTable,
	TransactionTable,
	TransactionTypeTable,
	VendorTable,
} from './Transactions'

export * from './Transactions'

export interface AccountTable {
	id: Generated<number>
	name: string
	bank: string | null
	// Which bank CSV normalizer to use when importing into this account; null for manual-only accounts.
	import_format: string | null
}

export interface Database {
	account: AccountTable
	transaction_type: TransactionTypeTable
	management_category: ManagementCategoryTable
	enterprise: EnterpriseTable
	vendor: VendorTable
	import_batch: ImportBatchTable
	square_category: SquareCategoryTable
	transaction: TransactionTable
}

export type Account = Selectable<AccountTable>
export type TransactionType = Selectable<TransactionTypeTable>
export type ManagementCategory = Selectable<ManagementCategoryTable>
export type Enterprise = Selectable<EnterpriseTable>
export type Vendor = Selectable<VendorTable>
export type NewVendor = Insertable<VendorTable>
export type VendorUpdate = Updateable<VendorTable>
export type SquareCategory = Selectable<SquareCategoryTable>
export type Transaction = Selectable<TransactionTable>
export type NewTransaction = Insertable<TransactionTable>
export type TransactionUpdate = Updateable<TransactionTable>
