
export interface TransactionType {
    Expense
    Income
    Asset Purchase
    Transfer
    Owner Contribution
    Owner Draw
    Loan Proceeds
    Loan Principal
    Tax Payment
}

export interface ManagementType {
	Feed
	Purchasedlivestock/chicks
	Processing
	Veterinary/medicine
	Bedding
	Seed/plants
	Packaging
	Otherdirectproduction
	Marketfees
	Merchant/cardprocessingfees
	Delivery/freight
	Advertising
	Website/e-commerce
	Labels/printedmaterial
	Fuel
	Repairs&maintenance
	Smalltools
	Utilities
	Insurance
	Professionalfees
	Property-relatedfarmexpenses
	Generalfarmsupplies
	Labor/payroll
	Vehicle
	Equipmentpurchase
	Buildings
	Permanentfencing
	Watersystems
	Landimprovement
	Orchard/perennialestablishment
	Vehiclepurchase
	Othercapitalasset
	Farmproductsales
	Livestocksales
	Preparedfoodsales
	Breedingstocksales
	Agrotourismincome
	Banktransfer
	Ownerfunds
	Loanactivity
	Taxpayment
	LGDSupplies
	TransportationCosts-Tolls
	TransportationCosts-Fuel
	CommercialKitchenRent
	Ingredients
}

interface EnterpriseCategory {
    Beef
    Lamb
    Feeder Pigs
    Breeder Pigs
    Broilers
    Eggs
    Ducks
    Prepared / Value-added
    Orchard / Perennials
    Agrotourism
    Farm-wide
    Farmers Markets
	Guardian Dogs
}

export interface Transactions {
	id: Generated<number>
	transaction_date: string
	account: Account
	transaction_type: TransactionType
	vendor: Vendor  
	management_type: ManagementCategory
    enterprise_category: EnterpriseCategory
    amount: number 
	description: string
}





