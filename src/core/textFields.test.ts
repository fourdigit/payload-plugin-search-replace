import type { Field, Payload } from 'payload'

import { describe, expect, test } from 'vitest'

import type { FieldFilter } from '../types.js'

import { collectTextEntries, DEFAULT_EXCLUDE, matchesPathGlob } from './textFields.js'

describe('matchesPathGlob', () => {
  test.each([
    ['slug', 'slug', true],
    ['slug', 'meta.slug', false],
    ['**.slug', 'slug', true],
    ['**.slug', 'meta.slug', true],
    ['**.slug', 'a.b.slug', true],
    ['meta.*', 'meta.description', true],
    ['meta.*', 'meta.og.title', false],
    ['meta.**', 'meta.og.title', true],
    ['*.title', 'title', false],
  ])('%s vs %s → %s', (pattern, path, expected) => {
    expect(matchesPathGlob(pattern, path)).toBe(expected)
  })
})

describe('collectTextEntries', () => {
  const collect = (fields: Field[], doc: Record<string, unknown>, filter?: FieldFilter) =>
    collectTextEntries({
      collection: 'pages',
      doc,
      filter,
      payload: { collections: { pages: { config: { fields } } }, config: {} } as unknown as Payload,
    }).map((entry) => entry.schemaPath)

  // As @payloadcms/plugin-nested-docs, plugin-stripe and Payload's upload fields add them.
  const fields: Field[] = [
    { name: 'title', type: 'text' },
    {
      name: 'breadcrumbs',
      type: 'array',
      fields: [{ type: 'row', fields: [{ name: 'url', type: 'text' }, { name: 'label', type: 'text' }] }],
    },
    { name: 'stripeID', type: 'text', admin: { readOnly: true } },
    { name: 'filename', type: 'text', admin: { hidden: true, readOnly: true } },
    { name: 'secret', type: 'text', hidden: true },
    {
      name: 'sizes',
      type: 'group',
      admin: { hidden: true },
      fields: [{ name: 'thumbnail', type: 'group', fields: [{ name: 'filename', type: 'text' }] }],
    },
  ]
  const doc = {
    breadcrumbs: [{ label: 'Parent', url: '/parent' }],
    filename: 'photo.jpg',
    secret: 'x',
    sizes: { thumbnail: { filename: 'photo-320.jpg' } },
    stripeID: 'prod_123',
    title: 'Title',
  }

  test('leaves out plugin-managed and hidden fields by default', () => {
    expect(collect(fields, doc)).toEqual(['title'])
  })

  test('a host exclude replaces the defaults; DEFAULT_EXCLUDE can be spread into it', () => {
    expect(collect(fields, doc, { exclude: [] })).toEqual(['title', 'breadcrumbs.url', 'breadcrumbs.label', 'stripeID'])
    expect(collect(fields, doc, { exclude: [...DEFAULT_EXCLUDE, 'title'] })).toEqual([])
  })

  test('include can bring back a hidden field', () => {
    const include = ({ schemaPath }: { schemaPath: string }) => (schemaPath === 'sizes.thumbnail.filename' ? true : undefined)
    expect(collect(fields, doc, { include })).toEqual(['title', 'sizes.thumbnail.filename'])
  })
})
