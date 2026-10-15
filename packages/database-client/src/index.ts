import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { env } from './env'
import type { Database } from './types'

export * from './types'

// Return DATE columns as 'YYYY-MM-DD' strings instead of local-midnight JS Dates.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value)

const pool = new pg.Pool({
	...env.pg,
})

export const db = new Kysely<Database>({
	dialect: new PostgresDialect({ pool }),
})
