import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Vendor } from '@tdf-mono/db-client'
import { makeVendorMatcher } from './vendorMatcher.js'

const vendor = (id: number, ...match_patterns: string[]): Vendor => ({
	id,
	name: match_patterns[0]!,
	match_patterns,
	default_transaction_type_id: null,
	default_management_category_id: null,
	default_enterprise_id: null,
})

test('longest matching pattern wins regardless of order', () => {
	const match = makeVendorMatcher([vendor(1, 'tractor'), vendor(2, 'Tractor  Supply'), vendor(3, 'amazon')])
	assert.equal(match('POS TRACTOR SUPPLY #0123 ATHENS')?.id, 2)
	assert.equal(match('TRACTOR PARTS CO')?.id, 1)
	assert.equal(match('GAS STATION'), undefined)
})

test('a vendor matches on any of its patterns', () => {
	const match = makeVendorMatcher([vendor(1, 'tractor supply', 'TRACTOR-SUPPLY'), vendor(2, 'tractor supply auto pymt')])
	assert.equal(match('TRACTOR SUPPLY #0657 ONEONTA')?.id, 1)
	assert.equal(match('POS TRACTOR-SUPPLY 2576')?.id, 1)
	assert.equal(match('TRACTOR SUPPLY AUTO PYMT')?.id, 2)
})
