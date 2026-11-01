import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set. Copy .env.local.example to .env.local and fill it in.')
  process.exit(1)
}

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url))
const schema = readFileSync(schemaPath, 'utf8')

const client = new pg.Client({ connectionString })
await client.connect()
try {
  await client.query(schema)
  console.log('Schema applied successfully.')
} finally {
  await client.end()
}
