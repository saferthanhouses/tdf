import { Hono } from 'hono'
import { layoutRows, listLayouts } from '../reports/layouts.js'

// P&L layouts with their rows (the ledger uses these to label a P&L line it's filtered to).
export const pnlLayouts = new Hono().get('/', async c => {
	const layouts = await listLayouts()
	return c.json(await Promise.all(layouts.map(async l => ({ ...l, rows: await layoutRows({ layoutId: l.id }) }))))
})

