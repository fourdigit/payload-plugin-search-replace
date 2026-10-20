import type { Field } from 'payload'

import { expect, test } from 'vitest'

import { generateSearchCollection } from './index.js'

test('index text is localized when the host has localization, even with localize: false', () => {
  const collection = generateSearchCollection({
    collections: ['posts'],
    labels: { posts: { plural: 'Posts', singular: 'Post' } },
    localize: false,
    localizeContent: true,
    reindexBatchSize: 50,
    syncDrafts: true,
  })
  const byName = Object.fromEntries(
    collection.fields.filter((field): field is { name: string } & Field => 'name' in field).map((f) => [f.name, f]),
  )
  expect(byName.title).toMatchObject({ localized: false })
  expect(byName.content).toMatchObject({ localized: true })
  expect(byName.contentRaw).toMatchObject({ localized: true })
})
