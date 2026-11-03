import { z } from 'zod'

// Env vars are injected by `dotenvx run` (see root package.json scripts) or compose.yaml.
// Same DB_* names as @tdf-mono/db-client, but this app connects to its own "farm" database.

const EnvSchema = z.object({
	DB_HOST: z.string().min(1).default('localhost'),
	DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
	DB_USER: z.string().min(1),
	DB_PASSWORD: z.string().min(1),
	DB_NAME: z.string().min(1),
	DB_SSLMODE: z.enum(['disable', 'require', 'verify-full']).default('disable'),
	PORT: z.coerce.number().int().min(1).max(65535).default(3002),
})

function loadEnv() {
	const result = EnvSchema.safeParse(process.env)
	if (!result.success) {
		const lines = result.error.issues.map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
		// Never print values here — they may include secrets
		console.error(`Invalid environment configuration:\n${lines.join('\n')}`)
		process.exit(1)
	}
	const e = result.data
	return {
		...e,
		// Ready to spread into `new Pool(...)` from node-postgres
		pg: {
			host: e.DB_HOST,
			port: e.DB_PORT,
			user: e.DB_USER,
			password: e.DB_PASSWORD,
			database: e.DB_NAME,
			ssl: e.DB_SSLMODE === 'disable' ? false : { rejectUnauthorized: e.DB_SSLMODE === 'verify-full' },
		},
	}
}

export const env = loadEnv()
