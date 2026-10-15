import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Vendor } from '@tdf-mono/db-client'
import { makeVendorMatcher } from './vendorMatcher.js'

const vendor = (id: number, match_pattern: string): Vendor => ({
	id,
	name: match_pattern,
	match_pattern,
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
