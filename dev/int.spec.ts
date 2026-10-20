import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

let payload: Payload

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

describe('search index (forked from @payloadcms/plugin-search)', () => {
  test('creates a search doc when a post is published', async () => {
    const post = await payload.create({
      collection: 'posts',
      data: { _status: 'published', title: 'Hello search' },
    })

    const { docs } = await payload.find({
      collection: 'search',
      where: { 'doc.value': { equals: post.id } },
    })

    expect(docs).toHaveLength(1)
    expect(docs[0]?.title).toBe('Hello search')
  })
})
