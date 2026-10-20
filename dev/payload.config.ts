import { searchPlugin } from '@fourdigit/payload-plugin-search-replace'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig, type DatabaseAdapterObj } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

/**
 * DATABASE_URL picks the adapter: postgres://… → Postgres, mongodb://… → MongoDB,
 * anything else (or unset) → SQLite. Tests run on an in-memory SQLite database.
 */
const getDatabaseAdapter = (): DatabaseAdapterObj => {
  const url = process.env.DATABASE_URL || ''

  if (url.startsWith('postgres')) {
    return postgresAdapter({ pool: { connectionString: url } })
  }

  if (url.startsWith('mongodb')) {
    return mongooseAdapter({ ensureIndexes: true, url })
  }

  return sqliteAdapter({
    client: {
      url: process.env.NODE_ENV === 'test' ? ':memory:' : url || `file:${path.resolve(dirname, 'dev.db')}`,
    },
  })
}

export default buildConfig({
  admin: {
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [
    {
      slug: 'posts',
      admin: {
        useAsTitle: 'title',
      },
      fields: [
        {
          name: 'title',
          type: 'text',
        },
        {
          name: 'content',
          type: 'richText',
        },
      ],
      versions: {
        drafts: true,
      },
    },
    {
      slug: 'media',
      fields: [],
      upload: {
        staticDir: path.resolve(dirname, 'media'),
      },
    },
  ],
  db: getDatabaseAdapter(),
  editor: lexicalEditor(),
  email: testEmailAdapter,
  onInit: async (payload) => {
    await seed(payload)
  },
  plugins: [
    searchPlugin({
      collections: ['posts'],
    }),
  ],
  secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
  sharp,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
