"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const DEFAULT_TRANSACTION_TYPE = "Expense";
const DEFAULT_MANAGEMENT_CATEGORY = "";
const DEFAULT_ENTERPRISE = "";
function returnDefaults(vendorStr) {
    return [vendorStr, DEFAULT_TRANSACTION_TYPE, DEFAULT_MANAGEMENT_CATEGORY, DEFAULT_ENTERPRISE];
}
const transactionTypes = [
    "Expense",
    "Income",
    "Asset Purchase",
    "Transfer",
    "Owner Contribution",
    "Owner Draw",
    "Loan Proceeds",
    "Loan Principal",
    "Tax Payment",
];
const managementCategories = [
    "Feed",
    "Purchased livestock / chicks",
    "Processing",
    "Veterinary / medicine",
    "Bedding",
    "Seed / plants",
    "Packaging",
    "Other direct production",
    "Market fees",
    "Merchant / card processing fees",
    "Delivery / freight",
    "Advertising",
    "Website / e-commerce",
    "Labels / printed material",
    "Fuel",
    "Repairs & maintenance",
    "Small tools",
    "Utilities",
    "Insurance",
    "Professional fees",
    "Property-related farm expenses",
    "General farm supplies",
    "Labor / payroll",
    "Vehicle",
    "Equipment purchase",
    "Buildings",
    "Permanent fencing",
    "Water systems",
    "Land improvement",
    "Orchard / perennial establishment",
    "Vehicle purchase",
    "Other capital asset",
    "Farm product sales",
    "Livestock sales",
    "Prepared food sales",
    "Breeding stock sales",
    "Agrotourism income",
    "Bank transfer",
    "Owner funds",
    "Loan activity",
    "Tax payment",
    "LGD Supplies",
    "Transportation Costs - Tolls",
    "Transportation Costs - Fuel",
    "Commercial Kitchen Rent",
    "Ingredients"
];
const enterprises = [
    "Beef",
    "Lamb",
    "Feeder Pigs",
    "Breeder Pigs",
    "Broilers",
    "Eggs",
    "Ducks",
    "Prepared / Value-added",
    "Orchard / Perennials",
    "Agrotourism",
    "Farm-wide",
    "Farmers Markets",
    "Guardian Dogs"
];
const accounts = [
    "Capital One - 9171",
    "DNBD - 6521",
    "Cash"
];
const classificationColumns = [
    "Vendor / Customer",
    "Type Override",
    "Category Override",
    "Enterprise Override",
];
