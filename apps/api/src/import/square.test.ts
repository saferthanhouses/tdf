import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSquareCategorySales, parseSquareFile, parseSquareSalesSummary, squareRangeFromFilename } from './square.js'

// Same layout as Square's exports (made-up amounts).
const categoryCsv = `Category,Items Sold,Gross Sales,Items Refunded,Refunds,Discounts & Comps,Net Sales,Taxes
Uncategorised,3,$45.00,0,$0.00,$0.00,$45.00,$0.00
Beef,10,"$1,200.50",0,$0.00,$0.00,"$1,200.50",$0.00
"Soups, Stews & Pasta Sauces",2,$30.00,0,$0.00,$0.00,$30.00,$1.20
`

const summaryCsv = `﻿"Sales summary - Summary
All day (00:00-23:59 New York Time)",
Gross sales,"$1,275.50"
Items,"$1,275.50"
Net sales,"$1,275.50"
Taxes,$1.20
Total payments collected,"$1,276.70"
Card,"$1,000.00"
Cash,$276.70
Fees,($29.10)
Square payment processing fees,($29.10)
Square fees,($29.10)
Net total,"$1,247.60"
Product sales transactions,40
`

test('category sales: one row per category, amounts in cents, quoted names and thousands', () => {
	assert.deepEqual(parseSquareCategorySales(categoryCsv), [
		{ category: 'Uncategorised', itemsSold: 3, netCents: 4500, taxCents: 0 },
		{ category: 'Beef', itemsSold: 10, netCents: 120050, taxCents: 0 },
		{ category: 'Soups, Stews & Pasta Sauces', itemsSold: 2, netCents: 3000, taxCents: 120 },
	])
	assert.throws(() => parseSquareCategorySales('Name,Amount\nx,1\n'), /no "Category" column/)
})

test('sales summary: skips the BOM and title, fees are money out', () => {
	assert.deepEqual(parseSquareSalesSummary(summaryCsv), {
		grossCents: 127550,
		netCents: 127550,
		taxCents: 120,
		cardCents: 100000,
		cashCents: 27670,
		feesCents: -2910,
		netTotalCents: 124760,
	})
})

test('files are recognised by their content', () => {
	assert.equal(parseSquareFile(categoryCsv).kind, 'categories')
	assert.equal(parseSquareFile(summaryCsv).kind, 'summary')
	assert.throws(() => parseSquareFile('Date,Amount\n'), /Not a Square/)
})

test('date range comes from Square’s file names', () => {
	assert.deepEqual(squareRangeFromFilename('category-sales-2026-05-01-2026-05-31.csv'), { from: '2026-05-01', to: '2026-05-31' })
	assert.equal(squareRangeFromFilename('export.csv'), null)
})
