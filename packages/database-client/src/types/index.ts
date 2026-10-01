import { Generated, Insertable, Selectable, Updateable} from 'kysely'

const transformedData = [
    ["Date", "Account", "Transaction Type", "Vendor", "Management Category", "Enterprise Category", "Amount", "Description"]
  ]

export interface Vendor {}

export interface Database {
	transactions: TransactionsTable
}

export interface Account {
	id: Generated<number>
	name: string
	bank: string
}

export interface TransactionsTable {
	id: Generated<number>
	transaction_date: string
	account: Account
	management_type: TransactionType
    vendor: Vendor  
}

