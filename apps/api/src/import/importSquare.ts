// Imports Square sales summaries (see square.ts) into the Square account as drafts:
//   one Income draft per item category (its management category and enterprise from square_category),
//   one Expense draft for Square's fees, and one for sales tax collected if there was any.
// Each is dated on the last day of the range. Square's payouts to the bank are the same money arriving, so
// the import also lists likely payout deposits for the user to re-type as transfers.
import { createHash } from 'node:crypto'
import { db, type NewTransaction } from '@tdf-mono/db-client'
import { ImportError } from './importCsv.js'
import { parseSquareFile, squareRangeFromFilename, type SquareCategorySales, type SquareSalesSummary } from './square.js'

const PAYOUT_LAG_DAYS = 5

export interface SquareImportArgs {
	files: { filename: string; csv: string }[]
	from?: string
	to?: string
	preview: boolean
}

export interface SquarePayoutCandidate {
	id: number
	date: string
	accountId: number
	description: string
	cents: number
	// Bank text or vendor mentions Square; pre-selected in the UI.
	likely: boolean
}

function readFiles(files: SquareImportArgs['files']) {
	let categories: SquareCategorySales[] | null = null
	let summary: SquareSalesSummary | null = null
	for (const f of files) {
		let parsed
		try {
			parsed = parseSquareFile(f.csv)
		} catch (e) {
			throw new ImportError(`${f.filename}: ${(e as Error).message}`)
		}
		if (parsed.kind === 'categories') categories = parsed.rows
		else summary = parsed.summary
	}
	if (!categories) throw new ImportError('Add the Square category sales export (the file with a Category column)')
	return { categories, summary }
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const formatCents = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export async function importSquare(args: SquareImportArgs) {
	const { categories, summary } = readFiles(args.files)
	const named = args.files.map(f => squareRangeFromFilename(f.filename)).find(r => r !== null)
	const from = args.from ?? named?.from
	const to = args.to ?? named?.to
	if (!from || !to) throw new ImportError('Choose the date range this export covers')
	if (from > to) throw new ImportError('The range starts after it ends')

	const account = await db.selectFrom('account').selectAll().where('import_format', '=', 'square').executeTakeFirst()
	if (!account) throw new ImportError('There is no Square account (run the database migrations)')

	const warnings: string[] = []
	const categoryTotal = categories.reduce((s, c) => s + c.netCents, 0)
	if (!summary) warnings.push('No sales summary file, so Square fees and the card/cash split are not imported.')
	else if (summary.netCents !== categoryTotal)
		warnings.push(`Categories add up to ${formatCents(categoryTotal)} but the summary’s net sales are ${formatCents(summary.netCents)}.`)

	// A range overlapping an earlier Square import would count the same sales twice.
	const overlapping = await db
		.selectFrom('import_batch as b')
		.select(['b.id', 'b.period_from', 'b.period_to'])
		.where('b.account_id', '=', account.id)
		.where('b.period_from', '<=', to)
		.where('b.period_to', '>=', from)
		.where(eb => eb.exists(eb.selectFrom('transaction as t').select('t.id').whereRef('t.import_batch_id', '=', 'b.id').where('t.status', '!=', 'dismissed')))
		.executeTakeFirst()
	const overlap = overlapping
		? `Square sales for ${overlapping.period_from} – ${overlapping.period_to} are already imported, which overlaps this range. To replace them, delete those Square drafts first (unposting any that are posted).`
		: null

	const [types, mgmt, known] = await Promise.all([
		db.selectFrom('transaction_type').select(['id', 'name']).execute(),
		db.selectFrom('management_category').select(['id', 'name', 'group']).execute(),
		db.selectFrom('square_category').selectAll().execute(),
	])
	const typeId = (name: string) => types.find(t => t.name === name)?.id ?? null
	const categoryId = (name: string) => mgmt.find(m => m.name === name)?.id ?? null
	// New Square categories start where Square deposits were categorised before.
	const defaultCategoryId = categoryId('Market Sales') ?? mgmt.find(m => m.group === 'income')?.id ?? null

	const lines = categories
		.filter(c => c.netCents !== 0)
		.map(c => {
			const mapping = known.find(k => k.name.toLowerCase() === c.category.toLowerCase())
			return {
				name: c.category,
				netCents: c.netCents,
				managementCategoryId: mapping ? mapping.management_category_id : defaultCategoryId,
				enterpriseId: mapping?.enterprise_id ?? null,
				isNew: !mapping,
			}
		})

	const payoutRows = await db
		.selectFrom('transaction as t')
		.leftJoin('vendor as v', 'v.id', 't.vendor_id')
		.innerJoin('transaction_type as tt', 'tt.id', 't.transaction_type_id')
		.select(['t.id', 't.date', 't.account_id', 't.raw_description', 't.description', 't.amount', 'v.name as vendorName'])
		.where('t.account_id', '!=', account.id)
		.where('t.status', 'in', ['draft', 'posted'])
		.where('t.amount', '>', '0')
		.where('tt.name', '=', 'Income')
		.where('t.date', '>=', from)
		.where('t.date', '<=', addDays(to, PAYOUT_LAG_DAYS))
		.orderBy('t.date')
		.execute()
	const payouts: SquarePayoutCandidate[] = payoutRows.map(r => ({
		id: r.id,
		date: r.date,
		accountId: r.account_id,
		description: r.vendorName ?? r.raw_description ?? r.description,
		cents: Math.round(Number(r.amount) * 100),
		likely: /square/i.test(`${r.vendorName ?? ''} ${r.raw_description ?? ''}`),
	}))

	const result = {
		from,
		to,
		accountId: account.id,
		categories: lines,
		summary,
		warnings,
		overlap,
		payouts,
		// What should have reached the bank: card takings less fees (cash stays in hand).
		expectedPayoutCents: summary ? summary.cardCents + summary.feesCents : null,
	}
	if (args.preview) return { ...result, imported: 0, batchId: null as number | null }
	if (overlap) throw new ImportError(overlap)

	return db.transaction().execute(async trx => {
		// Remember new Square categories so they can be mapped once and reused.
		const created = lines.filter(l => l.isNew)
		if (created.length)
			await trx
				.insertInto('square_category')
				.values(created.map(l => ({ name: l.name, management_category_id: l.managementCategoryId })))
				.onConflict(oc => oc.column('name').doNothing())
				.execute()

		const batch = await trx
			.insertInto('import_batch')
			.values({ account_id: account.id, filename: args.files.map(f => f.filename).join(', ').slice(0, 255), period_from: from, period_to: to })
			.returning('id')
			.executeTakeFirstOrThrow()

		const draft = (key: string, rawDescription: string, cents: number, fields: Partial<NewTransaction>): NewTransaction => ({
			status: 'draft',
			date: to,
			account_id: account.id,
			amount: (cents / 100).toFixed(2),
			raw_description: rawDescription,
			description: '',
			import_batch_id: batch.id,
			dedupe_hash: createHash('sha256').update(`square|${from}|${to}|${key}`).digest('hex'),
			transaction_type_id: null,
			management_category_id: null,
			enterprise_id: null,
			...fields,
		})
		const range = `${from} – ${to}`
		const rows: NewTransaction[] = lines.map(l =>
			draft(`category|${l.name.toLowerCase()}`, `Square sales: ${l.name} (${range})`, l.netCents, {
				transaction_type_id: typeId('Income'),
				management_category_id: l.managementCategoryId,
				enterprise_id: l.enterpriseId,
			}),
		)
		if (summary?.feesCents)
			rows.push(
				draft('fees', `Square fees (${range})`, summary.feesCents, {
					transaction_type_id: typeId('Expense'),
					management_category_id: categoryId('Merchant / card processing fees'),
				}),
			)
		// Sales tax collected belongs to the state, so it is kept out of revenue.
		const taxCents = summary?.taxCents ?? categories.reduce((s, c) => s + c.taxCents, 0)
		if (taxCents)
			rows.push(
				draft('tax', `Square sales tax collected (${range})`, taxCents, {
					transaction_type_id: typeId('Tax Payment'),
					management_category_id: categoryId('Tax payment'),
				}),
			)

		// Deleted (dismissed) drafts from an earlier import of this range give way to the new import, so a
		// corrected export can replace them. (Overlap with live rows was refused above.)
		await trx
			.deleteFrom('transaction')
			.where('status', '=', 'dismissed')
			.where('dedupe_hash', 'in', rows.map(r => r.dedupe_hash!))
			.execute()
		const inserted = await trx
			.insertInto('transaction')
			.values(rows)
			.onConflict(oc => oc.column('dedupe_hash').doNothing())
			.returning('id')
			.execute()
		if (!inserted.length) await trx.deleteFrom('import_batch').where('id', '=', batch.id).execute()
		return { ...result, imported: inserted.length, batchId: inserted.length ? batch.id : null }
	})
}

// Square payouts are money moving from Square to the bank, not new revenue (the sales were imported from
// Square), so they become transfers. Only positive Income-typed rows outside the Square account change.
export async function retypeSquarePayouts(ids: number[]) {
	const [transfer, bankTransfer, square] = await Promise.all([
		db.selectFrom('transaction_type').select('id').where('name', '=', 'Transfer').executeTakeFirst(),
		db.selectFrom('management_category').select('id').where('name', '=', 'Bank transfer').executeTakeFirst(),
		db.selectFrom('account').select('id').where('import_format', '=', 'square').executeTakeFirst(),
	])
	if (!transfer) throw new ImportError('There is no "Transfer" transaction type')
	const updated = await db
		.updateTable('transaction')
		.set({ transaction_type_id: transfer.id, management_category_id: bankTransfer?.id ?? null })
		.where('id', 'in', ids)
		.where('amount', '>', '0')
		.where('account_id', '!=', square?.id ?? 0)
		.where('transaction_type_id', 'in', db.selectFrom('transaction_type').select('id').where('name', '=', 'Income'))
		.returning('id')
		.execute()
	return { retyped: updated.length }
}

