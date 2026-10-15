import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { db } from '@tdf-mono/db-client'

const id = z.coerce.number().int().positive()
const name = z.string().trim().min(1).max(255)
const groups = ['direct_production', 'selling', 'overhead', 'capital', 'income', 'non_operating'] as const
const optionalId = id.nullable().optional()

const simpleLookup = z.object({ name, archived: z.boolean().optional() })
const managementCategory = z.object({ name, group: z.enum(groups), archived: z.boolean().optional() })
const vendor = z.object({
	name,
	match_pattern: name,
	default_transaction_type_id: optionalId,
	default_management_category_id: optionalId,
	default_enterprise_id: optionalId,
})

function notFound(): never {
	throw new HTTPException(404, { message: 'Not found' })
}

export const lookups = new Hono()
	.get('/lookups', async c => {
		const [accounts, transactionTypes, managementCategories, enterprises, vendors] = await Promise.all([
			db.selectFrom('account').selectAll().orderBy('name').execute(),
			db.selectFrom('transaction_type').selectAll().orderBy('id').execute(),
			db.selectFrom('management_category').selectAll().orderBy('group').orderBy('name').execute(),
			db.selectFrom('enterprise').selectAll().orderBy('name').execute(),
			db.selectFrom('vendor').selectAll().orderBy('name').execute(),
		])
		return c.json({ accounts, transactionTypes, managementCategories, enterprises, vendors })
	})

	// Lookup lists are archived rather than deleted so posted transactions keep their labels.
	.post('/transaction-types', async c => {
		const body = simpleLookup.parse(await c.req.json())
		return c.json(await db.insertInto('transaction_type').values(body).returningAll().executeTakeFirstOrThrow(), 201)
	})
	.patch('/transaction-types/:id', async c => {
		const body = simpleLookup.partial().parse(await c.req.json())
		const row = await db
			.updateTable('transaction_type')
			.set(body)
			.where('id', '=', id.parse(c.req.param('id')))
			.returningAll()
			.executeTakeFirst()
		return row ? c.json(row) : notFound()
	})

	.post('/management-categories', async c => {
		const body = managementCategory.parse(await c.req.json())
		return c.json(await db.insertInto('management_category').values(body).returningAll().executeTakeFirstOrThrow(), 201)
	})
	.patch('/management-categories/:id', async c => {
		const body = managementCategory.partial().parse(await c.req.json())
		const row = await db
			.updateTable('management_category')
			.set(body)
			.where('id', '=', id.parse(c.req.param('id')))
			.returningAll()
			.executeTakeFirst()
		return row ? c.json(row) : notFound()
	})

	.post('/enterprises', async c => {
		const body = simpleLookup.parse(await c.req.json())
		return c.json(await db.insertInto('enterprise').values(body).returningAll().executeTakeFirstOrThrow(), 201)
	})
	.patch('/enterprises/:id', async c => {
		const body = simpleLookup.partial().parse(await c.req.json())
		const row = await db
			.updateTable('enterprise')
			.set(body)
			.where('id', '=', id.parse(c.req.param('id')))
			.returningAll()
			.executeTakeFirst()
		return row ? c.json(row) : notFound()
	})

	.post('/vendors', async c => {
		const body = vendor.parse(await c.req.json())
		return c.json(await db.insertInto('vendor').values(body).returningAll().executeTakeFirstOrThrow(), 201)
	})
	.patch('/vendors/:id', async c => {
		const body = vendor.partial().parse(await c.req.json())
		const row = await db
			.updateTable('vendor')
			.set(body)
			.where('id', '=', id.parse(c.req.param('id')))
			.returningAll()
			.executeTakeFirst()
		return row ? c.json(row) : notFound()
	})
	.delete('/vendors/:id', async c => {
		const result = await db.deleteFrom('vendor').where('id', '=', id.parse(c.req.param('id'))).executeTakeFirst()
		return result.numDeletedRows ? c.body(null, 204) : notFound()
	})
