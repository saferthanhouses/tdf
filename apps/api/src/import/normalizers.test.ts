import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizers, parseAmount, parseDate } from './normalizers.js'

test('parseDate accepts ISO and US formats', () => {
	assert.equal(parseDate('2026-06-03'), '2026-06-03')
	assert.equal(parseDate('6/3/2026'), '2026-06-03')
	assert.equal(parseDate('06/03/26'), '2026-06-03')
	assert.throws(() => parseDate('2/30/2026'))
	assert.throws(() => parseDate('June 3'))
})

test('parseAmount handles currency symbols, commas and parentheses', () => {
	assert.equal(parseAmount('$1,234.56'), 1234.56)
	assert.equal(parseAmount('(12.00)'), -12)
	assert.equal(parseAmount('-5'), -5)
	assert.throws(() => parseAmount(''))
	assert.throws(() => parseAmount('-'))
})

test('capital one: debits are negative, credits positive', () => {
	const row = ['9171', 'TRACTOR SUPPLY #123', '06/03/26', 'Debit', '45.10', '1000']
	assert.deepEqual(normalizers.capital_one!(row), { date: '2026-06-03', rawDescription: 'TRACTOR SUPPLY #123', amount: -45.1 })
	assert.equal(normalizers.capital_one!(['9171', 'SQUARE', '06/03/26', 'Credit', '200', '1200']).amount, 200)
})

test('dnbd: debit column is money out, credit column is money in', () => {
	assert.equal(normalizers.dnbd!(['', '', '45.10', '', '', '6/3/2026', 'FEED STORE']).amount, -45.1)
	assert.equal(normalizers.dnbd!(['', '', '', '300', '', '6/3/2026', 'DEPOSIT']).amount, 300)
})
