import { Hono } from 'hono'
import { z } from 'zod'
import { importCsv } from '../import/importCsv.js'
import { importSquare, retypeSquarePayouts } from '../import/importSquare.js'

const importBody = z.object({
	accountId: z.number().int().positive(),
	filename: z.string().max(255).nullable().default(null),
	csv: z.string().min(1),
})

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const squareBody = z.object({
	files: z.array(z.object({ filename: z.string().max(255), csv: z.string().min(1) })).min(1).max(2),
	from: isoDate.optional(),
	to: isoDate.optional(),
	// Preview parses and checks without writing anything.
	preview: z.boolean().default(false),
})

export const imports = new Hono()
	.post('/', async c => {
		const body = importBody.parse(await c.req.json())
		return c.json(await importCsv(body), 201)
	})
	.post('/square', async c => {
		const body = squareBody.parse(await c.req.json())
		const result = await importSquare(body)
		return c.json(result, body.preview ? 200 : 201)
	})
	.post('/square/retype-payouts', async c => {
		const { ids } = z.object({ ids: z.array(z.number().int().positive()).min(1) }).parse(await c.req.json())
		return c.json(await retypeSquarePayouts(ids))
	})
