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
