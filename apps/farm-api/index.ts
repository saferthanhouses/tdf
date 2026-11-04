import { serve } from '@hono/node-server'
import { createApp } from './src/app.js'
import { env } from './src/env.js'
import { subscribe, unsubscribe } from './src/subscribers.js'

const app = createApp({ subscribe, unsubscribe })

serve({ fetch: app.fetch, port: env.PORT }, info => {
	console.log(`farm api listening on http://localhost:${info.port}`)
})
