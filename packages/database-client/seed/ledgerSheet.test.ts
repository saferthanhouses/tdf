import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firstEnterprise, isBankText, isoDate, parseLedgerSheet } from './ledgerSheet'

const sheet = [
	'Date,Transaction Type,Account,Vendor,Management Category,Enterprise,Amount,Description',
	'08/27/2026,Expense,,Tractor Supply,General Farm Supplies,,-41.98,Electric fence reel & insulators',
	"07/16/2026,Expense,Capital One,Debit Card Purchase - LOWE'S #1967 ONEONTA, NY US,Small tools,,-210.94,",
	'06/15/2026,Expense,Capital One - 9171,Lutz Feed,Feed,Meat Birds, Layers,-84.84,',
].join('\n')

test('rejoins values that were split on commas', () => {
	const rows = parseLedgerSheet(sheet)
	assert.equal(rows[0]!.repaired, false)
	assert.equal(rows[1]!.vendor, "Debit Card Purchase - LOWE'S #1967 ONEONTA, NY US")
	assert.equal(rows[1]!.category, 'Small tools')
	assert.equal(rows[1]!.amount, '-210.94')
	assert.equal(rows[2]!.enterprise, 'Meat Birds, Layers')
	assert.equal(rows[2]!.amount, '-84.84')
	assert.equal(rows[2]!.repaired, true)
})

test('helpers', () => {
	assert.equal(isoDate('6/5/2026', 2), '2026-06-05')
	assert.equal(firstEnterprise('Meat Birds / Ducks'), 'Meat Birds')
	assert.equal(firstEnterprise('Meat Birds, Layers'), 'Meat Birds')
	assert.equal(firstEnterprise('Prepared / Value-added'), 'Prepared')
	assert.ok(isBankText('Check #399 Cashed'))
	assert.ok(!isBankText('Tractor Supply'))
})

test('reads tab-separated files by header name, in any column order, skipping blank lines', () => {
	const tsv = [
		'Date\tAccount\tTransaction Type\tVendor\tManagement Category\tEnterprise Category\tAmount\tDescription',
		'12/16/2025\tDNBD - 6521\tExpense\tTractor Supply, Inc\tFeed\t\t-134.38\tbags of feed, layers',
		'\t\t\t\t\t\t\t',
		'1/2/2025\tCapital One - 9171\tIncome\tSquare Inc\tMarket Sales\tFarm-wide\t250\t',
	].join('\n')
	const rows = parseLedgerSheet(tsv)
	assert.equal(rows.length, 2)
	assert.deepEqual(
		{ ...rows[0]!, line: 0 },
		{
			line: 0,
			repaired: false,
			date: '12/16/2025',
			type: 'Expense',
			account: 'DNBD - 6521',
			vendor: 'Tractor Supply, Inc',
			category: 'Feed',
			enterprise: '',
			amount: '-134.38',
			description: 'bags of feed, layers',
		},
	)
	assert.equal(rows[1]!.enterprise, 'Farm-wide')
	assert.equal(rows[1]!.line, 4)
})

test('a missing required column is reported by name', () => {
	assert.throws(() => parseLedgerSheet('Date\tVendor\tAmount\n1/2/2025\tX\t1'), /missing: type, account, category, enterprise/)
})

test('recognises DNBD and Capital One bank wording', () => {
	for (const s of [
		'Pinned POS Debit 10/04 NY STAMFORD SUNOCO 02672517 SEQ# 234002',
		'ATM Withdrawal 10/23 NY DELHI 121 MAIN ST SEQ# 003433',
		'ATM SERVICE CHARGE For Withdrawal',
		'Recur Payment 10/01 NY NEW YORK SQSP* WEBSIT#20 SEQ# 357660',
		'628554 INTERNET TRANSFER FROM EZ CHECKING 10245744 ON 11/13/25 13:47',
		'OVERDRAWN ACCOUNT PENALTY FEE',
		'NSF PAID ITEM(S) FEE',
		'Check',
		"Cashier's Check Payment to Delaware County Treasurer",
		'hydrants - Deposit from 360 Performance Savings XXXXXXX7115',
		'FMNP ACCT VERIFY (2297)VRFY 2297 ACCTVERIFY',
		'POS Return 08/17 NY STAMFORD TRACTOR S 65384 1 SEQ# 950695',
		'VENMO CASHOUT 1041054522894',
	]) {
		assert.ok(isBankText(s), s)
	}
	for (const s of ['Tractor Supply', 'NY FMNP PYMT NYFMNPPYMT 415625', 'Checkers Farm Supply']) {
		assert.ok(!isBankText(s), s)
	}
})
