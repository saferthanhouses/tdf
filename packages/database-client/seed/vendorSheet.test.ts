import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupVendorRows, parseVendorSheet } from './vendorSheet'

const sheet = [
	'Vendor / Customer\tDefault Type\tDefault Management Category\tDefault Enterprise\tNotes',
	'Tractor Supply\tExpense\t\t\t',
	'TRACTOR-SUPPLY\tExpense\t\t\t',
	'McDowell Walker Inc\tExpense\t\t\t',
	'MCDOWELL & WALK\tExpense\t\t\t',
	'TRACTOR SUPPLY AUTO PYMT\tLoan Principal\tVehicle Purchase\t\t',
	'ULINE \tExpense\tPackaging\t\t',
	'\t\t\t\t',
].join('\n')

test('parses the tab-separated sheet, trimming cells and skipping blank rows', () => {
	const rows = parseVendorSheet(sheet)
	assert.equal(rows.length, 6)
	assert.deepEqual(rows[5], { line: 7, name: 'ULINE', type: 'Expense', category: 'Packaging', enterprise: '' })
})

test('similar names with identical defaults merge; different defaults stay separate', () => {
	const groups = groupVendorRows(parseVendorSheet(sheet))
	assert.deepEqual(
		groups.map(g => [g.name, g.patterns]),
		[
			['Tractor Supply', ['Tractor Supply', 'TRACTOR-SUPPLY']],
			['McDowell Walker Inc', ['McDowell Walker Inc', 'MCDOWELL & WALK']],
			['TRACTOR SUPPLY AUTO PYMT', ['TRACTOR SUPPLY AUTO PYMT']],
			['ULINE', ['ULINE']],
		],
	)
})
