import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { sql } from 'kysely'
import { z } from 'zod'
import { db } from '@tdf-mono/db-client'
import { makeClassifier } from '../import/importCsv.js'

const id = z.coerce.number().int().positive()
const optionalId = id.nullable().optional()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const listQuery = z.object({
	status: z.enum(['draft', 'posted']).default('draft'),
	from: isoDate.optional(),
	to: isoDate.optional(),
	accountId: id.optional(),
})

const transactionFields = z.object({
	date: isoDate,
	account_id: id,
	transaction_type_id: optionalId,
	vendor_id: optionalId,
	management_category_id: optionalId,
	enterprise_id: optionalId,
	amount: z.coerce.number().finite().transform(n => n.toFixed(2)),
	description: z.string().max(10_000).optional(),
})

export const transactions = new Hono()
	.get('/', async c => {
		const q = listQuery.parse(c.req.query())
		let query = db.selectFrom('transaction').selectAll().where('status', '=', q.status)
		if (q.from) query = query.where('date', '>=', q.from)
		if (q.to) query = query.where('date', '<=', q.to)
		if (q.accountId) query = query.where('account_id', '=', q.accountId)
		// Drafts are worked through in date order; the ledger shows newest first.
		const direction = q.status === 'draft' ? 'asc' : 'desc'
		return c.json(await query.orderBy('date', direction).orderBy('id', direction).execute())
	})

	// Manually entered transactions (e.g. cash) start as drafts like imported ones.
	.post('/', async c => {
		const body = transactionFields.parse(await c.req.json())
		return c.json(await db.insertInto('transaction').values(body).returningAll().executeTakeFirstOrThrow(), 201)
	})

	.patch('/:id', async c => {
		const body = transactionFields.partial().parse(await c.req.json())
		const row = await db
			.updateTable('transaction')
			.set(body)
			.where('id', '=', id.parse(c.req.param('id')))
			.returningAll()
			.executeTakeFirst()
		if (!row) throw new HTTPException(404, { message: 'Not found' })
		return c.json(row)
	})

	.delete('/:id', async c => {
		const result = await db
			.deleteFrom('transaction')
			.where('id', '=', id.parse(c.req.param('id')))
			.where('status', '=', 'draft')
			.executeTakeFirst()
		if (!result.numDeletedRows) throw new HTTPException(404, { message: 'Draft not found' })
		return c.body(null, 204)
	})

	// Move drafts into the ledger. Drafts missing a type or category are left as drafts and reported back.
	.post('/post', async c => {
		const { ids } = z.object({ ids: z.array(id).min(1) }).parse(await c.req.json())
		const posted = await db
			.updateTable('transaction')
			.set({ status: 'posted', posted_at: sql`now()` })
			.where('id', 'in', ids)
			.where('status', '=', 'draft')
			.where('transaction_type_id', 'is not', null)
			.where('management_category_id', 'is not', null)
			.returning('id')
			.execute()
		const postedIds = new Set(posted.map(r => r.id))
		return c.json({ posted: postedIds.size, incomplete: ids.filter(i => !postedIds.has(i)) })
	})

	.post('/:id/unpost', async c => {
		const row = await db
			.updateTable('transaction')
			.set({ status: 'draft', posted_at: null })
			.where('id', '=', id.parse(c.req.param('id')))
			.where('status', '=', 'posted')
			.returningAll()
			.executeTakeFirst()
		if (!row) throw new HTTPException(404, { message: 'Posted transaction not found' })
		return c.json(row)
	})

	// Re-run vendor rules over drafts that have no vendor yet, e.g. after adding a vendor.
	// Only empty fields are filled so manual edits are not overwritten.
	.post('/rematch-drafts', async c => {
		const { classify, fallbackTypeId } = await makeClassifier()
		const drafts = await db
			.selectFrom('transaction')
			.selectAll()
			.where('status', '=', 'draft')
			.where('vendor_id', 'is', null)
			.where('raw_description', 'is not', null)
			.execute()

		let matched = 0
		await db.transaction().execute(async trx => {
			for (const t of drafts) {
				const amount = Number(t.amount)
				const match = classify(t.raw_description!, amount)
				if (!match.vendor_id) continue
				matched++
				// The Income/Expense type set at import is a guess, so the vendor's default replaces it.
				const typeWasGuessed = t.transaction_type_id === null || t.transaction_type_id === fallbackTypeId(amount)
				await trx
					.updateTable('transaction')
					.set({
						vendor_id: match.vendor_id,
						transaction_type_id: typeWasGuessed ? match.transaction_type_id : t.transaction_type_id,
						management_category_id: t.management_category_id ?? match.management_category_id,
						enterprise_id: t.enterprise_id ?? match.enterprise_id,
					})
					.where('id', '=', t.id)
					.execute()
			}
		})
		return c.json({ matched })
	})
