import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp, type Signup } from './app.js'
import { RateLimiter } from './rateLimit.js'

const TOKEN = '0b8f2a4e-6c1d-4e2a-9f3b-7d5c1a2e8f90'

function setup(limiter?: RateLimiter) {
	const saved: Signup[] = []
	const unsubscribed: string[] = []
	const app = createApp({
		subscribe: async s => void saved.push(s),
		// Only TOKEN belongs to a subscriber.
		unsubscribe: async t => (t === TOKEN ? (unsubscribed.push(t), true) : false),
		limiter,
	})
	return { app, saved, unsubscribed }
}

const form = (fields: Record<string, string>, headers: Record<string, string> = {}) => ({
	method: 'POST',
	body: new URLSearchParams(fields),
	headers,
})
const json = (body: unknown, headers: Record<string, string> = {}) => ({
	method: 'POST',
	body: JSON.stringify(body),
	headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
})

test('a form post saves the normalized email and redirects to the thank-you page', async () => {
	const { app, saved } = setup()
	const res = await app.request('/api/subscribe', form({ email: '  Jo@Example.COM ', source: '/markets' }))
	assert.equal(res.status, 303)
	assert.equal(res.headers.get('location'), '/subscribed')
	assert.deepEqual(saved, [{ email: 'jo@example.com', source: '/markets' }])
})

test('a JSON post gets a JSON answer', async () => {
	const { app, saved } = setup()
	const res = await app.request('/api/subscribe', json({ email: 'jo@example.com' }))
	assert.equal(res.status, 200)
	assert.equal(((await res.json()) as { ok: boolean }).ok, true)
	assert.equal(saved.length, 1)
})

test('an invalid email is rejected with a message', async () => {
	const { app, saved } = setup()
	const res = await app.request('/api/subscribe', json({ email: 'not-an-email' }))
	assert.equal(res.status, 400)
	assert.equal(((await res.json()) as { error: string }).error,'Please enter a valid email address')
	assert.equal(saved.length, 0)
})

test('a missing email is rejected', async () => {
	const { app } = setup()
	const res = await app.request('/api/subscribe', form({}))
	assert.equal(res.status, 400)
})

test('a filled-in honeypot looks like success but saves nothing', async () => {
	const { app, saved } = setup()
	const res = await app.request('/api/subscribe', json({ email: 'bot@example.com', website: 'http://spam' }))
	assert.equal(res.status, 200)
	assert.equal(saved.length, 0)
})

test('a source that is not a path on this site is dropped', async () => {
	const { app, saved } = setup()
	await app.request('/api/subscribe', json({ email: 'a@example.com', source: '//evil.example' }))
	await app.request('/api/subscribe', json({ email: 'b@example.com', source: 'https://evil.example' }))
	assert.deepEqual(saved.map(s => s.source), [undefined, undefined])
})

test('signups are rate limited per client address', async () => {
	const { app, saved } = setup(new RateLimiter(2, 60_000))
	const from = (ip: string) => json({ email: 'jo@example.com' }, { 'x-forwarded-for': `10.0.0.9, ${ip}` })
	assert.equal((await app.request('/api/subscribe', from('1.1.1.1'))).status, 200)
	assert.equal((await app.request('/api/subscribe', from('1.1.1.1'))).status, 200)
	assert.equal((await app.request('/api/subscribe', from('1.1.1.1'))).status, 429)
	assert.equal((await app.request('/api/subscribe', from('2.2.2.2'))).status, 200)
	assert.equal(saved.length, 3)
})

test('oversized bodies are refused', async () => {
	const { app, saved } = setup()
	const res = await app.request('/api/subscribe', json({ email: 'jo@example.com', source: '/' + 'x'.repeat(5000) }))
	assert.equal(res.status, 413)
	assert.equal(saved.length, 0)
})

test('the rate limit window resets', () => {
	let now = 0
	const limiter = new RateLimiter(1, 1000, () => now)
	assert.equal(limiter.allow('ip'), true)
	assert.equal(limiter.allow('ip'), false)
	now = 1000
	assert.equal(limiter.allow('ip'), true)
})

test('the unsubscribe page posts the token and gets JSON back', async () => {
	const { app, unsubscribed } = setup()
	const res = await app.request('/api/unsubscribe', json({ token: TOKEN }))
	assert.equal(res.status, 200)
	assert.equal(((await res.json()) as { ok: boolean }).ok, true)
	assert.deepEqual(unsubscribed, [TOKEN])
})

test('one-click unsubscribe from a mail client: token in the URL, plain 200', async () => {
	const { app, unsubscribed } = setup()
	const res = await app.request(`/api/unsubscribe?token=${TOKEN}`, form({ 'List-Unsubscribe': 'One-Click' }))
	assert.equal(res.status, 200)
	assert.deepEqual(unsubscribed, [TOKEN])
})

test('unsubscribing is POST only, so link scanners can not do it', async () => {
	const { app, unsubscribed } = setup()
	const res = await app.request(`/api/unsubscribe?token=${TOKEN}`)
	assert.equal(res.status, 404)
	assert.equal(unsubscribed.length, 0)
})

test('a missing or malformed token is rejected', async () => {
	const { app } = setup()
	assert.equal((await app.request('/api/unsubscribe', json({}))).status, 400)
	assert.equal((await app.request('/api/unsubscribe', json({ token: 'not-a-uuid' }))).status, 400)
})

test('an unknown token says so', async () => {
	const { app, unsubscribed } = setup()
	const res = await app.request('/api/unsubscribe', json({ token: '11111111-2222-4333-8444-555555555555' }))
	assert.equal(res.status, 404)
	assert.match(((await res.json()) as { error: string }).error, /couldn't find/)
	assert.equal(unsubscribed.length, 0)
})
