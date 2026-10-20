import { searchReplacePlugin } from '@fourdigit/payload-plugin-search-replace'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { en } from '@payloadcms/translations/languages/en'
import { ja } from '@payloadcms/translations/languages/ja'
import path from 'path'
import { buildConfig, type DatabaseAdapterObj } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { devUser } from './helpers/credentials.js'
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
          localized: true,
        },
        {
          name: 'slug',
          type: 'text',
        },
        {
          name: 'content',
          type: 'richText',
          localized: true,
        },
        {
          name: 'sections',
          type: 'array',
          fields: [
            {
              name: 'heading',
              type: 'text',
            },
            {
              name: 'tags',
              type: 'text',
              hasMany: true,
            },
          ],
        },
        {
          name: 'layout',
          type: 'blocks',
          blocks: [
            {
              slug: 'callout',
              fields: [
                {
                  name: 'body',
                  type: 'textarea',
                },
              ],
            },
          ],
        },
        {
          type: 'tabs',
          tabs: [
            {
              name: 'meta',
              fields: [
                {
                  name: 'description',
                  type: 'textarea',
                },
              ],
            },
          ],
        },
      ],
      versions: {
        drafts: true,
      },
    },
    {
      // No drafts, readable only by the dev user, and one field nobody may update.
      slug: 'notes',
      access: {
        read: ({ req }) => req.user?.email === devUser.email,
        update: ({ req }) => req.user?.email === devUser.email,
      },
      admin: {
        useAsTitle: 'title',
      },
      fields: [
        {
          name: 'title',
          type: 'text',
        },
        {
          name: 'locked',
          type: 'text',
          access: {
            update: () => false,
          },
        },
        {
          name: 'body',
          type: 'textarea',
        },
      ],
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
  i18n: {
    supportedLanguages: { en, ja },
  },
  localization: {
    defaultLocale: 'ja',
    fallback: true,
    locales: ['ja', 'en'],
  },
  onInit: async (payload) => {
    await seed(payload)
  },
  plugins: [
    searchReplacePlugin({
      collections: ['posts', 'notes'],
      replace: {
        canUseRegex: ({ req }) => req.user?.email === devUser.email,
        maxApplyDocs: 50,
      },
    }),
  ],
  secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
  sharp,
  typescript: {
    // Keep the plugin source checked against Payload's generic types, as it is in the host app.
    declare: false,
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
