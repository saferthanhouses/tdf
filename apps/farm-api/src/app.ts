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

// The subscriber's unsubscribe_token, from the link in our emails.
const token = z.uuid()

export interface Deps {
	subscribe: (signup: Signup) => Promise<void>
	// False if no subscriber has this token.
	unsubscribe: (token: string) => Promise<boolean>
	limiter?: RateLimiter
}

// Browsers without JavaScript post the form normally and land on a thank-you page. The site's script
// asks for JSON instead, to show the result in place.
function wantsJson(c: Context) {
	return (c.req.header('accept') ?? '').includes('application/json')
}

function respond(c: Context, status: 200 | 400 | 404 | 429, message: string, redirectTo?: string) {
	if (wantsJson(c)) return c.json(status === 200 ? { ok: true, message } : { error: message }, status)
	if (status === 200 && redirectTo) return c.redirect(redirectTo, 303)
	return c.text(message, status)
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
	return (c.req.header('content-type') ?? '').includes('application/json')
		? await c.req.json().catch(() => ({}))
		: await c.req.parseBody()
}

// Caddy appends the client's address to X-Forwarded-For; only Caddy can reach this service, so the
// last entry is the real client. Locally there's no header and everyone shares one bucket.
function clientIp(c: Context) {
	return c.req.header('x-forwarded-for')?.split(',').pop()?.trim() || 'local'
}

export function createApp({ subscribe, unsubscribe, limiter = new RateLimiter(10, 10 * 60_000) }: Deps) {
	const app = new Hono().basePath('/api')

	app.get('/health', c => c.json({ ok: true }))

	app.post('/subscribe', bodyLimit({ maxSize: 4 * 1024 }), async c => {
		if (!limiter.allow(clientIp(c))) return respond(c, 429, 'Too many signups from here. Please try again later.')

		const parsed = signup.safeParse(await readBody(c))
		if (!parsed.success) {
			const message = parsed.error.issues.find(i => i.path[0] === 'email')?.message ?? 'Invalid request'
			return respond(c, 400, message)
		}

		const { email, source, website } = parsed.data
		// Same answer whether it's new, already subscribed or a bot, so the form can't be used to
		// find out who is on the list.
		if (!website) await subscribe({ email, source })
		return respond(c, 200, "Thanks! You're on the list.", '/subscribed')
	})

	// POST only: email scanners open every link in a message, so a GET would unsubscribe people
	// by accident. Our emails link to the site's /unsubscribe?token=… page, which posts here. The
	// token can also be in the URL, for mail clients' own unsubscribe button (RFC 8058 one-click:
	// List-Unsubscribe: <https://…/api/unsubscribe?token=…> with List-Unsubscribe-Post).
	// Tokens are random UUIDs, so there's nothing to guess and no rate limit.
	app.post('/unsubscribe', bodyLimit({ maxSize: 4 * 1024 }), async c => {
		const body = await readBody(c)
		const parsed = token.safeParse(c.req.query('token') ?? body.token)
		if (!parsed.success) {
			return respond(c, 400, "That unsubscribe link isn't complete. Please email us and we'll take you off the list.")
		}
		if (!(await unsubscribe(parsed.data))) {
			return respond(c, 404, "We couldn't find that subscription. Please email us and we'll take you off the list.")
		}
		return respond(c, 200, "You're unsubscribed. You won't get any more emails from us.")
	})

	app.onError((err, c) => {
		if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
		console.error(err)
		return c.json({ error: 'Something went wrong. Please try again.' }, 500)
	})

	return app
}
