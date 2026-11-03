import { db } from './db.js'
import type { Signup } from './app.js'

// Adds the address, or re-subscribes it if it had unsubscribed. Keeps the original signup date.
export async function subscribe({ email, source }: Signup): Promise<void> {
	await db
		.insertInto('subscriber')
		.values({ email, source: source ?? null })
		.onConflict(oc => oc.column('email').doUpdateSet({ unsubscribed_at: null }))
		.execute()
}
