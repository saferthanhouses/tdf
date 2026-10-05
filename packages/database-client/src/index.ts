mport { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { Database } from './types

export * from './types'

const pool = new Pool({
	max: 20,
	idleTimeoutMillis: 30000,
	connectionString: process.env.DATABASE_URL
})

export const db = new Kysely<Database>({
	dialect: new PostgresDialect({ pool })
})
