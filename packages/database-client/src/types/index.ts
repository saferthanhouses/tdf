import { Generated, Insertable, Selectable, Updateable} from 'kysely'
import { Transactions } from './Transactions'
const transformedData = [
    ["Date", "Account", "Transaction Type", "Vendor", "Management Category", "Enterprise Category", "Amount", "Description"]
  ]

export interface Vendor {}

export interface Database {
	transactions: Transactions
	accounts: Account 
}


export interface Account {
	id: Generated<number>
	name: string
	bank: string
}
