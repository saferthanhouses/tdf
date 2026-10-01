
const csvUploadSheetName = "_csv_upload";
const draftTransactionsSheetName = "_draft_transactions"
const vendorMappingSheetName = "Vendors";

function _loadVendorLookup(ss){
  const vendorMappingSheet = ss.getSheetByName(vendorMappingSheetName)
  if (!vendorMappingSheet) {
    Logger.log("Error: Sheet named '" + vendorMappingSheetName + "' was not found.");
    return; 
  }
  const range = vendorMappingSheet.getDataRange()
  const [_headers, ...data] = range.getValues()

  const vendorMap = {}
  const vendorNameList = []
  for (const [vendorStr, ...vendorData] of data){
    const vendorName = vendorStr.toLowerCase().replace(/\s+/g, ' ').trim() // ["tractor supply"]
    if (isEmpty(vendorName)) continue
    // Default Type,	Default Management Category,	Default Enterprise
    vendorMap[vendorName] = [vendorStr, ...vendorData]
    vendorNameList.push(vendorName);
  }

  function lookupVendorFromStr(vendorStr){
    const normalizedStr = vendorStr.toLowerCase().replace(/\s+/g, ' ').trim() // "tractor supply"
    let longestMatch = -1 
    for (let i = 0; i< vendorNameList.length; i++){
      if (~normalizedStr.indexOf(vendorNameList[i])){
        if (~!longestMatch) {
          longestMatch = i
          continue
        }
        if (vendorNameList[i].length > vendorNameList[longestMatch].length){
          longestMatch = i
        } 
      }
    }


    let vendorBase = returnDefaults(vendorStr)
    let vendorMatch = []
    if (~longestMatch){
      vendorMatch = vendorMap[vendorNameList[longestMatch]]
    }

    return [
      vendorMatch[0] || vendorStr,
      vendorMatch[1] || vendorBase[1],
      vendorMatch[2] || vendorBase[2],
      vendorMatch[3] || vendorBase[3]
    ]
  }    
  
  return lookupVendorFromStr
}

const isEmpty = (val) => val.length===0

function normalizeCSV(makeTransformerFunc) {
  /* 
   * transformerArray: an array of transformer functions, each of which 
   * describes how to map from a    row of the transactions of 
   * unnormalized transactions of that bank type to the normalized columns  
   */
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  const sheet = ss.getSheetByName(csvUploadSheetName)

  // Safety Check: If the sheet name is misspelled or doesn't exist, stop the script
  if (!sheet) {
    Logger.log("Error: Sheet named '" + csvUploadSheet + "' was not found.");
    return; 
  }

  const vendorLookupFunc = _loadVendorLookup(ss)  

  const transformerFunc = makeTransformerFunc(vendorLookupFunc)

  const range = sheet.getDataRange();
  const data = range.getValues();
  const transformedData = [
    ["Date", "Account", "Transaction Type", "Vendor", "Management Category", "Enterprise Category", "Amount", "Description"]
  ]
  
  // move to the first row with content
  let seenHeaderRow = false
  for (const [i, row] of data.entries()) {
      let emptyRow = row.every(isEmpty)
      if (emptyRow) continue 
      
      if (!emptyRow && !seenHeaderRow) {
        seenHeaderRow = true;
      } else {
        transformedData.push(transformerFunc(row))
      } 
  }

  writeDraftTransactions(ss, transformedData)
// normalized columns: Date	Transaction Type	Vendor	Management Category	Enterprise	Amount	Description
}

function writeDraftTransactions(ss, transformedData){

  const sheet = ss.getSheetByName(draftTransactionsSheetName)
  if (!sheet) {
    Logger.log("Error: Sheet named '" + draftTransactionsSheetName + "' was not found.");
    return; 
  }

  const response = getConfirmationBeforeProceeding(normalizeCSVMessage) 
  if (!response) return;

  sheet.clearContents();

  const startRow = 1;
  const startColumn = 1;
  const totalRows = transformedData.length;       
  const totalColumns = transformedData[0].length;
  
  // 5. Select the exact grid area and stamp the data all at once
  // getRange(startRow, startColumn, numRows, numColumns)
  sheet.getRange(startRow, startColumn, totalRows, totalColumns)
    .setValues(transformedData)
}

function normalizeCapitalOne(){
  // Account Number,	Transaction Description (vendor in here),	Transaction Date	Transaction Type	Transaction Amount	Balance
  const account = "Capital One - 9171"

  function makeRowTransformer(vendorLookupFunc){
    return (row) => {
      const date = row[2]
      const vendorText = row[1]
      const amount = (row[3].toLowerCase() === "debit" ? 0-row[4] : row[4])

      const vendorInfo = vendorLookupFunc(vendorText)

      return [
        date,
        vendorInfo[1], // Transaction Type
        account,
        vendorInfo[0],// Vendor Name 
        vendorInfo[2],// Management Category
        vendorInfo[3], // Enterprise
        amount, 
        ''
      ]
    }
  }

  normalizeCSV(makeRowTransformer)
}

function normalizeDNBD(){
  const account = "DNBD - 6521"

    function makeRowTransformer(vendorLookupFunc){
    return (row) => {
      const date = row[5]
      const vendorText = row[6]
      const amount = row[2] ? -(row[2]) : row[3]

      const vendorInfo = vendorLookupFunc(vendorText)

      return [
        date,
        vendorInfo[1], // Transaction Type
        account,
        vendorInfo[0],// Vendor Name 
        vendorInfo[2],// Management Category
        vendorInfo[3], // Enterprise
        amount, 
        ''
      ]
    }
  }
  normalizeCSV(makeRowTransformer)
}