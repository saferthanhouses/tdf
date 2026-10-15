import { Hono } from 'hono'
import { z } from 'zod'
import { importCsv } from '../import/importCsv.js'

const importBody = z.object({
	accountId: z.number().int().positive(),
	filename: z.string().max(255).nullable().default(null),
	csv: z.string().min(1),
})

export const imports = new Hono().post('/', async c => {
	const body = importBody.parse(await c.req.json())
	return c.json(await importCsv(body), 201)
})
