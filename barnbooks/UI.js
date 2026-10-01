"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function onOpen() {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('Import Actions')
        .addItem('Normalize Capital One CSV', 'normalizeCapitalOne')
        .addSeparator()
        .addItem('Normalize DNBD CSV', 'normalizeDNBD')
        .addSeparator()
        .addItem('Add Transactions From Draft', 'addTransactions')
        .addToUi();
}
const normalizeCSVMessage = "Normalizing CSV will overwrite data in draft transactions. Do you wish to continue?";
const addTransactionsMessage = "";
function getConfirmationBeforeProceeding(message) {
    const ui = SpreadsheetApp.getUi();
    // Show a high-stakes confirmation popup with YES/NO buttons
    const confirmation = ui.alert('Confirm Overwrite', message, ui.ButtonSet.YES_NO);
    return confirmation == ui.Button.YES;
}
