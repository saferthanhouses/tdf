// Imports the old Google Sheet's Transaction Ledger (exported as CSV).
//
//   npm run db:seed:transactions                       # from the repo root, uses seed/transactions.csv
//   npm run db:seed:transactions -- --dry-run          # print the plan without writing
//   npm run db:seed:transactions -- path/to/file.csv
//
// Rows with a type and management category are imported as posted (they come from the ledger); rows missing
// either become drafts. Vendors are matched by name, then by match pattern; unknown names become new vendors.
// Bank text in the vendor column ('Debit Card Purchase - ...') is kept as the bank description with no vendor.
// Safe to re-run: each row gets a dedupe hash, so rows already imported are skipped.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { db, type NewTransaction } from '../src'
import { firstEnterprise, isBankText, isoDate, parseLedgerSheet } from './ledgerSheet'

// Sheet spellings that don't match a name in the database (compared ignoring case).
const ACCOUNT_ALIASES: Record<string, string> = {
	'': 'Capital One - 9171', // August rows were entered without an account
	'capital one': 'Capital One - 9171',
}
const ENTERPRISE_ALIASES: Record<string, string> = {
	layers: 'Eggs',
	'prepared / value add': 'Prepared / Value-added',
	'astoria fm': 'Farmers Markets',
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const file = resolve(args.find(a => !a.startsWith('--')) ?? 'seed/transactions.csv')

const lower = (s: string) => s.toLowerCase()
const normalize = (s: string) => lower(s).replace(/\s+/g, ' ').trim()

async function main() {
	const rows = parseLedgerSheet(readFileSync(file, 'utf8'))

	const [accounts, types, categories, enterprises, vendors] = await Promise.all([
		db.selectFrom('account').select(['id', 'name']).execute(),
		db.selectFrom('transaction_type').select(['id', 'name']).execute(),
		db.selectFrom('management_category').select(['id', 'name']).execute(),
		db.selectFrom('enterprise').select(['id', 'name']).execute(),
		db.selectFrom('vendor').selectAll().execute(),
	])

	const problems: string[] = []
	const byName = (list: { id: number; name: string }[], name: string) => list.find(i => lower(i.name) === lower(name))
	const lookup = (kind: string, list: { id: number; name: string }[], name: string, line: number) => {
		if (!name) return null
		const found = byName(list, name)
		if (!found) problems.push(`  line ${line}: unknown ${kind} "${name}"`)
		return found?.id ?? null
	}

	// Full name first ('Prepared / Value-added'), then the first of several ('Meat Birds / Ducks').
	const enterpriseNotes: string[] = []
	const resolveEnterprise = (raw: string, line: number) => {
		if (!raw) return null
		const aliased = (name: string) => ENTERPRISE_ALIASES[lower(name)] ?? name
		const whole = byName(enterprises, aliased(raw))
		if (whole) return whole.id
		const first = aliased(firstEnterprise(raw))
		const found = byName(enterprises, first)
		if (found) {
			enterpriseNotes.push(`  line ${line}: "${raw}" -> ${found.name}`)
			return found.id
		}
		problems.push(`  line ${line}: unknown enterprise "${raw}"`)
		return null
	}

	// Longest match pattern wins, as in the app's importer.
	const patterns = vendors
		.flatMap(v => v.match_patterns.map(p => ({ vendor: v, pattern: normalize(p) })))
		.filter(p => p.pattern)
		.sort((a, b) => b.pattern.length - a.pattern.length)
	const newVendors = new Map<string, string>() // lower(name) -> name
	const resolveVendor = (text: string): { vendorId: number | null; newVendor: string | null; bankText: boolean } => {
		if (!text) return { vendorId: null, newVendor: null, bankText: false }
		const exact = vendors.find(v => lower(v.name) === lower(text))
		if (exact) return { vendorId: exact.id, newVendor: null, bankText: false }
		const pattern = patterns.find(p => normalize(text).includes(p.pattern))
		if (pattern) return { vendorId: pattern.vendor.id, newVendor: null, bankText: false }
		if (isBankText(text)) return { vendorId: null, newVendor: null, bankText: true }
		if (!newVendors.has(lower(text))) newVendors.set(lower(text), text)
		return { vendorId: null, newVendor: newVendors.get(lower(text))!, bankText: false }
	}

	const occurrences = new Map<string, number>()
	const planned = rows.map(r => {
		const accountName = ACCOUNT_ALIASES[lower(r.account)] ?? r.account
		const date = isoDate(r.date, r.line)
		const amount = Number(r.amount)
		if (!r.amount || Number.isNaN(amount)) problems.push(`  line ${r.line}: invalid amount "${r.amount}"`)
		const transaction_type_id = lookup('transaction type', types, r.type, r.line)
		const management_category_id = lookup('management category', categories, r.category, r.line)
		const vendor = resolveVendor(r.vendor)

		// Identical rows are legitimate (two equal purchases on one day), so the occurrence count is part of the hash.
		const key = ['ledger-seed', lower(accountName), date, amount.toFixed(2), normalize(r.vendor), normalize(r.description)].join('|')
		const n = (occurrences.get(key) ?? 0) + 1
		occurrences.set(key, n)

		return {
			line: r.line,
			repaired: r.repaired,
			vendor,
			values: {
				status: transaction_type_id && management_category_id ? 'posted' : 'draft',
				date,
				account_id: lookup('account', accounts, accountName, r.line) ?? 0,
				transaction_type_id,
				management_category_id,
				enterprise_id: resolveEnterprise(r.enterprise, r.line),
				amount: amount.toFixed(2),
				description: r.description,
				raw_description: vendor.bankText ? r.vendor : null,
				dedupe_hash: createHash('sha256').update(`${key}|${n}`).digest('hex'),
			} satisfies Omit<NewTransaction, 'vendor_id'>,
		}
	})

	if (problems.length) {
		console.error(`Not imported. Fix these in the sheet or add the names in the app:\n${problems.join('\n')}`)
		process.exitCode = 1
		return
	}

	const existingHashes = new Set(
		(
			await db
				.selectFrom('transaction')
				.select('dedupe_hash')
				.where('dedupe_hash', 'in', planned.map(p => p.values.dedupe_hash))
				.execute()
		).map(r => r.dedupe_hash),
	)
	const toInsert = planned.filter(p => !existingHashes.has(p.values.dedupe_hash))
	const vendorsToCreate = [...new Set(toInsert.flatMap(p => (p.vendor.newVendor ? [p.vendor.newVendor] : [])))]
	const count = <T,>(list: T[], f: (x: T) => boolean) => list.filter(f).length

	console.log(`${rows.length} rows in ${file}`)
	console.log(`  ${count(rows, r => r.repaired)} rows had values split on commas and were rejoined`)
	console.log(`  ${existingHashes.size} already imported, ${toInsert.length} to import:`)
	for (const a of accounts) {
		const n = count(toInsert, p => p.values.account_id === a.id)
		if (n) console.log(`    ${a.name}: ${n}`)
	}
	console.log(`    posted: ${count(toInsert, p => p.values.status === 'posted')}, drafts (no type or category): ${count(toInsert, p => p.values.status === 'draft')}`)
	console.log(`    vendor matched: ${count(toInsert, p => p.vendor.vendorId !== null)}, new vendor: ${count(toInsert, p => p.vendor.newVendor !== null)}, bank text with no vendor: ${count(toInsert, p => p.vendor.bankText)}`)
	if (vendorsToCreate.length) console.log(`  new vendors (${vendorsToCreate.length}):\n${vendorsToCreate.map(v => `    ${v}`).join('\n')}`)
	if (enterpriseNotes.length) console.log(`  rows with several enterprises, recorded against the first:\n${enterpriseNotes.join('\n')}`)

	if (dryRun) {
		console.log('Dry run: nothing written.')
		return
	}

	await db.transaction().execute(async trx => {
		const createdIds = new Map<string, number>()
		for (const name of vendorsToCreate) {
			const { id } = await trx
				.insertInto('vendor')
				.values({ name, match_patterns: [name] })
				.returning('id')
				.executeTakeFirstOrThrow()
			createdIds.set(name, id)
		}
		if (!toInsert.length) return
		await trx
			.insertInto('transaction')
			.values(
				toInsert.map(p => ({
					...p.values,
					vendor_id: p.vendor.vendorId ?? (p.vendor.newVendor ? createdIds.get(p.vendor.newVendor)! : null),
					posted_at: p.values.status === 'posted' ? new Date() : null,
				})),
			)
			.onConflict(oc => oc.column('dedupe_hash').doNothing())
			.execute()
	})
	console.log('Done.')
}

main()
	.catch(e => {
		console.error(e)
		process.exitCode = 1
	})
	.finally(() => db.destroy())
