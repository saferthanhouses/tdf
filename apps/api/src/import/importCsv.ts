import { createHash } from 'node:crypto'
import { parse } from 'csv-parse/sync'
import { db, type NewTransaction, type Vendor } from '@tdf-mono/db-client'
import { normalizers, type NormalizedRow } from './normalizers.js'
import { makeVendorMatcher, normalizeText } from './vendorMatcher.js'

export class ImportError extends Error {
	constructor(
		message: string,
		readonly rowErrors: { line: number; message: string }[] = [],
	) {
		super(message)
	}
}

// Category fields to fill from a matched vendor, falling back to Income/Expense by sign.
export async function makeClassifier() {
	const [vendors, types] = await Promise.all([
		db.selectFrom('vendor').selectAll().execute(),
		db.selectFrom('transaction_type').select(['id', 'name']).execute(),
	])
	const matchVendor = makeVendorMatcher(vendors)
	const typeId = (name: string) => types.find(t => t.name === name)?.id ?? null
	const fallbackTypeId = (amount: number) => typeId(amount > 0 ? 'Income' : 'Expense')

	const classify = (rawDescription: string, amount: number) => {
		const vendor: Vendor | undefined = matchVendor(rawDescription)
		return {
			vendor_id: vendor?.id ?? null,
			transaction_type_id: vendor?.default_transaction_type_id ?? fallbackTypeId(amount),
			management_category_id: vendor?.default_management_category_id ?? null,
			enterprise_id: vendor?.default_enterprise_id ?? null,
		}
	}
	return { classify, fallbackTypeId }
}

export async function importCsv(args: { accountId: number; filename: string | null; csv: string }) {
	const account = await db.selectFrom('account').selectAll().where('id', '=', args.accountId).executeTakeFirst()
	if (!account) throw new ImportError(`Account ${args.accountId} not found`)
	const normalize = account.import_format ? normalizers[account.import_format] : undefined
	if (!normalize) throw new ImportError(`Account "${account.name}" has no CSV import format`)

	// csv-parse's types don't reflect the { record, info } shape returned when `info` is set.
	let parsed: { record: string[]; info: { lines: number } }[]
	try {
		parsed = parse(args.csv, {
			bom: true,
			relax_column_count: true,
			skip_empty_lines: true,
			info: true,
		}) as unknown as typeof parsed
	} catch (e) {
		throw new ImportError(`Could not read CSV: ${(e as Error).message}`)
	}
	const records = parsed.map(r => ({ line: r.info.lines, row: r.record }))

	// First non-empty row is the header.
	const dataRows = records.slice(1).filter(r => r.row.some(c => c.trim() !== ''))

	const rowErrors: { line: number; message: string }[] = []
	const normalized: NormalizedRow[] = []
	for (const { line, row } of dataRows) {
		try {
			normalized.push(normalize(row))
		} catch (e) {
			rowErrors.push({ line, message: (e as Error).message })
		}
	}
	if (rowErrors.length) throw new ImportError(`${rowErrors.length} row(s) could not be read; nothing was imported`, rowErrors)

	const { classify } = await makeClassifier()
	// Identical rows within one file are legitimate (e.g. two $5 market fees on one day),
	// so the occurrence count is part of the hash. Re-importing an overlapping file reproduces the same hashes.
	const occurrences = new Map<string, number>()

	return db.transaction().execute(async trx => {
		const batch = await trx
			.insertInto('import_batch')
			.values({ account_id: account.id, filename: args.filename })
			.returning('id')
			.executeTakeFirstOrThrow()

		const rows: NewTransaction[] = normalized.map(r => {
			const amount = r.amount.toFixed(2)
			const key = [account.id, r.date, amount, normalizeText(r.rawDescription)].join('|')
			const n = (occurrences.get(key) ?? 0) + 1
			occurrences.set(key, n)
			return {
				status: 'draft',
				date: r.date,
				account_id: account.id,
				amount,
				raw_description: r.rawDescription,
				description: '',
				import_batch_id: batch.id,
				dedupe_hash: createHash('sha256').update(`${key}|${n}`).digest('hex'),
				...classify(r.rawDescription, r.amount),
			}
		})

		const inserted = rows.length
			? await trx
					.insertInto('transaction')
					.values(rows)
					.onConflict(oc => oc.column('dedupe_hash').doNothing())
					.returning('id')
					.execute()
			: []

		if (inserted.length === 0) await trx.deleteFrom('import_batch').where('id', '=', batch.id).execute()

		return {
			batchId: inserted.length ? batch.id : null,
			imported: inserted.length,
			duplicates: rows.length - inserted.length,
		}
	})
}
