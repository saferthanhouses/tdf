import type { Vendor } from '@tdf-mono/db-client'

export const normalizeText = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

// Returns the vendor whose match_pattern is the longest substring of the bank description.
export function makeVendorMatcher(vendors: Vendor[]) {
	const patterns = vendors
		.map(vendor => ({ vendor, pattern: normalizeText(vendor.match_pattern) }))
		.filter(p => p.pattern.length > 0)
		.sort((a, b) => b.pattern.length - a.pattern.length)

	return (rawDescription: string): Vendor | undefined => {
		const text = normalizeText(rawDescription)
		return patterns.find(p => text.includes(p.pattern))?.vendor
	}
}
