import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { RateLimiter } from './rateLimit.js'

// Public API for the farm website, served under /api on the site's own domain (see the Caddyfile),
// so the site's forms can post here without CORS.

export const signup = z.object({
	email: z
		.string()
		.trim()
		.toLowerCase()
		.max(254, 'That email address is too long')
		.pipe(z.email('Please enter a valid email address')),
	// The page the form is on. Ignored if it doesn't look like a path on this site.
	source: z
		.string()
		.max(255)
		.optional()
		.transform(s => (s && /^\/(?!\/)/.test(s) ? s : undefined)),
	// Honeypot: hidden from people, so only bots fill it in.
	website: z.string().optional(),
})

export type Signup = Pick<z.infer<typeof signup>, 'email' | 'source'>

export interface Deps {
	subscribe: (signup: Signup) => Promise<void>
	limiter?: RateLimiter
}

// Browsers without JavaScript post the form normally and land on a thank-you page. The site's script
// asks for JSON instead, to show the result in place.
function wantsJson(c: Context) {
	return (c.req.header('accept') ?? '').includes('application/json')
}

function respond(c: Context, status: 200 | 400 | 429, message: string) {
	if (wantsJson(c)) return c.json(status === 200 ? { ok: true, message } : { error: message }, status)
	if (status === 200) return c.redirect('/subscribed', 303)
	return c.text(message, status)
}

// Caddy appends the client's address to X-Forwarded-For; only Caddy can reach this service, so the
// last entry is the real client. Locally there's no header and everyone shares one bucket.
function clientIp(c: Context) {
	return c.req.header('x-forwarded-for')?.split(',').pop()?.trim() || 'local'
}

export function createApp({ subscribe, limiter = new RateLimiter(10, 10 * 60_000) }: Deps) {
	const app = new Hono().basePath('/api')

	app.get('/health', c => c.json({ ok: true }))

	app.post('/subscribe', bodyLimit({ maxSize: 4 * 1024 }), async c => {
		if (!limiter.allow(clientIp(c))) return respond(c, 429, 'Too many signups from here. Please try again later.')

		const body = (c.req.header('content-type') ?? '').includes('application/json')
			? await c.req.json().catch(() => ({}))
			: await c.req.parseBody()
		const parsed = signup.safeParse(body)
		if (!parsed.success) {
			const message = parsed.error.issues.find(i => i.path[0] === 'email')?.message ?? 'Invalid request'
			return respond(c, 400, message)
		}

		const { email, source, website } = parsed.data
		// Same answer whether it's new, already subscribed or a bot, so the form can't be used to
		// find out who is on the list.
		if (!website) await subscribe({ email, source })
		return respond(c, 200, "Thanks! You're on the list.")
	})

	app.onError((err, c) => {
		if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
		console.error(err)
		return c.json({ error: 'Something went wrong. Please try again.' }, 500)
	})

	return app
}
