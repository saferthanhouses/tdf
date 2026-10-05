import { defineConfig } from 'kysely-ctl'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { env } from './src/env'

export default defineConfig({
	dialect: new PostgresDialect({
		pool: new Pool({
		   ...env.pg
		})
	}),
	migrations: {
		migrationFolder: "migrations"
	}
})


