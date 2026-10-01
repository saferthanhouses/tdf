"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Direct Production Categories:
// Feed, processing, vet, inputs, etc.
const directProductionCategories = [
    "Feed",
    "Purchased livestock / chicks",
    "Processing",
    "Veterinary / medicine",
    "Bedding",
    "Seed / plants",
    "Packaging",
    "Other direct production",
    "Ingredients",
    "Labels / printed material",
    "Packaging",
    "Commercial Kitchen Rent",
];
// Selling Costs: Market, merchant, marketing, delivery
const sellingCostCategories = [
    "Market fees",
    "Merchant / card processing fees",
    "Advertising",
    "Website / e-commerce",
    "Transportation Costs - Tolls",
    "Transportation Costs - Fuel",
];
const farmOverheadCategories = [
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
    "Loan activity",
    "Tax payment",
];
const capitalCategories = [
    "Vehicle",
    "Equipment purchase",
    "Buildings",
    "Permanent fencing",
    "Water systems",
    "Land improvement",
    "Orchard / perennial establishment",
    "Vehicle purchase",
    "Other capital asset",
];
function createPLForJune() {
    createProfitLossForMonth(null, 5, 2026, 10953.34);
}
function createProfitLossForMonth(_sheet, month, year, sales) {
    // Date, Transaction Type, Account, Vendor, Management Category, Amount, Description
    const transactions = loadTransactions(_sheet);
    const transactionsInDateRange = transactions.filter(([date, ...rest]) => {
        const dateMonth = date.getUTCMonth();
        const dateYear = date.getFullYear();
        return date.getUTCMonth() === month &&
            date.getFullYear() === year;
    });
    const directProductCosts = transactionsInDateRange.filter(([_date, _type, _account, _vendor, category]) => directProductionCategories.includes(category)).reduce((accum, [_date, _type, _account, _vendor, _category, _blank, amount]) => accum += amount, 0);
    const sellingCostCosts = transactionsInDateRange.filter(([_date, _type, _account, _vendor, category]) => sellingCostCategories.includes(category)).reduce((accum, [_date, _type, _account, _vendor, _category, _blank, amount]) => accum += amount, 0);
    const overheadCosts = transactionsInDateRange.filter(([_date, _type, _account, _vendor, category]) => farmOverheadCategories.includes(category)).reduce((accum, [_date, _type, _account, _vendor, _category, _blank, amount]) => accum += amount, 0);
    const capitalInvestment = transactionsInDateRange.filter(([_date, _type, _account, _vendor, category]) => capitalCategories.includes(category)).reduce((accum, [_date, _type, _account, _vendor, _category, _blank, amount]) => accum += amount, 0);
    const grossMargin = sales + directProductCosts;
    const operatingProfit = grossMargin + sellingCostCosts + overheadCosts;
    Logger.log(directProductCosts, sellingCostCosts, overheadCosts, capitalInvestment, grossMargin, operatingProfit);
}
function loadTransactions() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Transaction Ledger");
    if (!sheet) {
        Logger.log("Error: Sheet named '" + draftTransactionsSheetName + "' was not found.");
        return;
    }
    const range = sheet.getDataRange();
    const [_header, ...values] = range.getValues();
    return values;
}
function searchTransactions(transactionsSheet) {
    const range = transactionsSheet.getDataRange();
    const [_headers, ...data] = range.getValues();
    return data;
}
