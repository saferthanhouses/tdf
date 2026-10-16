// Imports vendors from the old Google Sheet's Vendors tab (exported as tab-separated text).
//
//   npm run db:seed:vendors                       # from the repo root, uses seed/vendors.csv
//   npm run db:seed:vendors -- --dry-run          # print the plan without writing
//   npm run db:seed:vendors -- path/to/file.tsv
//
// Safe to re-run: a sheet vendor that matches an existing vendor (by name or by a shared match pattern)
// only gains missing patterns and fills defaults that are still empty, so edits made in the app are kept.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { db } from '../src'
import { groupVendorRows, parseVendorSheet } from './vendorSheet'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const file = resolve(args.find(a => !a.startsWith('--')) ?? 'seed/vendors.csv')

const lower = (s: string) => s.toLowerCase()

async function main() {
	const groups = groupVendorRows(parseVendorSheet(readFileSync(file, 'utf8')))

	const [types, categories, enterprises, existing] = await Promise.all([
		db.selectFrom('transaction_type').select(['id', 'name']).execute(),
		db.selectFrom('management_category').select(['id', 'name']).execute(),
		db.selectFrom('enterprise').select(['id', 'name']).execute(),
		db.selectFrom('vendor').selectAll().execute(),
	])

	// Sheet names differ from ours in capitalisation ('Professional Fees'), so lookups ignore case.
	const unknown: string[] = []
	const resolver = (kind: string, list: { id: number; name: string }[]) => (name: string, lines: number[]) => {
		if (!name) return null
		const found = list.find(item => lower(item.name) === lower(name))
		if (!found) unknown.push(`  line ${lines.join(', ')}: ${kind} "${name}"`)
		return found?.id ?? null
	}
	const typeId = resolver('transaction type', types)
	const categoryId = resolver('management category', categories)
	const enterpriseId = resolver('enterprise', enterprises)

	const resolved = groups.map(g => ({
		...g,
		default_transaction_type_id: typeId(g.type, g.lines),
		default_management_category_id: categoryId(g.category, g.lines),
		default_enterprise_id: enterpriseId(g.enterprise, g.lines),
	}))

	if (unknown.length) {
		console.error(`Not imported. These names don't exist yet; add them in the app or fix the sheet:\n${unknown.join('\n')}`)
		process.exitCode = 1
		return
	}

	const plan = resolved.map(g => {
		const match = existing.find(
			v =>
				lower(v.name) === lower(g.name) ||
				v.match_patterns.some(p => g.patterns.some(q => lower(p) === lower(q))),
		)
		if (!match) return { kind: 'create' as const, group: g }

		const newPatterns = g.patterns.filter(p => !match.match_patterns.some(q => lower(q) === lower(p)))
		const fills = {
			...(match.default_transaction_type_id === null && g.default_transaction_type_id !== null
				? { default_transaction_type_id: g.default_transaction_type_id }
				: {}),
			...(match.default_management_category_id === null && g.default_management_category_id !== null
				? { default_management_category_id: g.default_management_category_id }
				: {}),
			...(match.default_enterprise_id === null && g.default_enterprise_id !== null
				? { default_enterprise_id: g.default_enterprise_id }
				: {}),
		}
		const changed = newPatterns.length > 0 || Object.keys(fills).length > 0
		return { kind: changed ? ('update' as const) : ('unchanged' as const), group: g, match, newPatterns, fills }
	})

	for (const p of plan) {
		const spellings = p.group.patterns.map(s => `"${s}"`).join(', ')
		if (p.kind === 'create') console.log(`create     ${p.group.name}  [${spellings}]`)
		else if (p.kind === 'update')
			console.log(
				`update     ${p.match.name}` +
					(p.newPatterns.length ? `  +patterns [${p.newPatterns.map(s => `"${s}"`).join(', ')}]` : '') +
					(Object.keys(p.fills).length ? `  +defaults ${Object.keys(p.fills).join(', ')}` : ''),
			)
		else console.log(`unchanged  ${p.match.name}`)
	}
	const count = (kind: string) => plan.filter(p => p.kind === kind).length
	console.log(`\n${count('create')} to create, ${count('update')} to update, ${count('unchanged')} unchanged.`)

	if (dryRun) {
		console.log('Dry run: nothing written.')
		return
	}

	await db.transaction().execute(async trx => {
		for (const p of plan) {
			if (p.kind === 'create') {
				const { name, patterns, default_transaction_type_id, default_management_category_id, default_enterprise_id } = p.group
				await trx
					.insertInto('vendor')
					.values({
						name,
						match_patterns: patterns,
						default_transaction_type_id,
						default_management_category_id,
						default_enterprise_id,
					})
					.execute()
			} else if (p.kind === 'update') {
				await trx
					.updateTable('vendor')
					.set({ ...p.fills, match_patterns: [...p.match.match_patterns, ...p.newPatterns] })
					.where('id', '=', p.match.id)
					.execute()
			}
		}
	})
	console.log('Done. Use "Re-apply vendor rules" on the Drafts page to match existing drafts.')
}

main()
	.catch(e => {
		console.error(e)
		process.exitCode = 1
	})
	.finally(() => db.destroy())
