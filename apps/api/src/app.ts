import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { lookups } from './routes/lookups.js'
import { transactions } from './routes/transactions.js'
import { imports } from './routes/imports.js'
import { reports } from './routes/reports.js'
import { pnlLayouts } from './routes/pnlLayouts.js'
import { ImportError } from './import/importCsv.js'

export const app = new Hono()
	.basePath('/api')
	.route('/', lookups)
	.route('/transactions', transactions)
	.route('/imports', imports)
	.route('/reports', reports)
	.route('/pnl-layouts', pnlLayouts)

app.onError((err, c: Context) => {
	if (err instanceof HTTPException) return err.getResponse()
	if (err instanceof z.ZodError) return c.json({ error: 'Invalid request', issues: err.issues }, 400)
	if (err instanceof ImportError) return c.json({ error: err.message, rowErrors: err.rowErrors }, 400)
	// Postgres error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
	const code = (err as { code?: string }).code
	if (code === '23505') return c.json({ error: 'That name is already in use' }, 409)
	if (code === '23503') return c.json({ error: 'Referenced record does not exist or is still in use' }, 400)
	console.error(err)
	return c.json({ error: 'Internal server error' }, 500)
})
