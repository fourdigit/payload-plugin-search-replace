import { describe, expect, test } from 'vitest'

import { matchesPathGlob } from './textFields.js'

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
