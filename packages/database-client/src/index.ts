mport { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { Database } from './types

export * from './types'

const pool = new Pool({
	...env.pg
})

export const db = new Kysely<Database>({
	dialect: new PostgresDialect({ pool })
})
