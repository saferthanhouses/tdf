import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely'
import pg from 'pg'
import { env } from './env.js'

export interface SubscriberTable {
	id: Generated<number>
	// Stored trimmed and lowercased, so the unique constraint catches the same address typed differently.
	email: string
	// The page the form was submitted from, e.g. "/" or "/markets".
	source: string | null
	// For unsubscribe links in the emails we send.
	unsubscribe_token: Generated<string>
	created_at: ColumnType<Date, never, never>
	unsubscribed_at: Date | null
}

export interface Database {
	subscriber: SubscriberTable
}

export const db = new Kysely<Database>({
	dialect: new PostgresDialect({ pool: new pg.Pool({ ...env.pg }) }),
})
