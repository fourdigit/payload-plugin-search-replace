import { describe, expect, test } from 'vitest'

import { createMatcher, foldCase, InvalidPatternError, type MatchOptions } from './matcher.js'

const options = (overrides: Partial<MatchOptions> = {}): MatchOptions => ({
  caseSensitive: true,
  mode: 'text',
  normalizeWidth: false,
  ...overrides,
})

const ranges = (find: string, text: string, overrides?: Partial<MatchOptions>, replace = 'X') =>
  createMatcher({ find, options: options(overrides), replace })
    .findAll(text)
    .map(({ end, replacement, start, text: matched }) => ({ end, matched, replacement, start }))

describe('text mode', () => {
  test('finds every occurrence', () => {
    expect(ranges('ab', 'ab-ab')).toEqual([
      { end: 2, matched: 'ab', replacement: 'X', start: 0 },
      { end: 5, matched: 'ab', replacement: 'X', start: 3 },
    ])
  })

  test('treats regex syntax literally', () => {
    expect(ranges('a.b', 'axb a.b')).toEqual([{ end: 7, matched: 'a.b', replacement: 'X', start: 4 }])
  })

  test('respects case sensitivity', () => {
    expect(ranges('ab', 'AB ab')).toHaveLength(1)
    expect(ranges('ab', 'AB ab', { caseSensitive: false })).toHaveLength(2)
  })

  test('does not expand $ in the replacement', () => {
    expect(ranges('a', 'a', {}, '$&$1')[0]?.replacement).toBe('$&$1')
  })
})

describe('width normalization', () => {
  test('matches full-width letters and maps back to the original range', () => {
    expect(ranges('ABC', 'xＡＢＣy', { normalizeWidth: true })).toEqual([
      { end: 4, matched: 'ＡＢＣ', replacement: 'X', start: 1 },
    ])
  })

  test('half-width katakana with a voiced mark is one unit', () => {
    // ｶﾞ is two code points that normalize to ガ
    expect(ranges('ガイド', 'ｶﾞｲﾄﾞです', { normalizeWidth: true })).toEqual([
      { end: 5, matched: 'ｶﾞｲﾄﾞ', replacement: 'X', start: 0 },
    ])
  })

  test('a normalized search text matches the plain form too', () => {
    expect(ranges('ＡＢＣ', 'ABC', { normalizeWidth: true })).toHaveLength(1)
  })

  test('only the matched range is replaced, surrounding text keeps its width', () => {
    const text = 'ＡＢＣとABC'
    const [first, second] = createMatcher({
      find: 'abc',
      options: options({ caseSensitive: false, normalizeWidth: true }),
      replace: 'xyz',
    }).findAll(text)
    expect(first).toMatchObject({ end: 3, start: 0, text: 'ＡＢＣ' })
    expect(second).toMatchObject({ end: 7, start: 4, text: 'ABC' })
  })

  test('Hangul jamo compose like NFKC of the whole text', () => {
    expect(ranges('\uAC00', '\u1100\u1161', { normalizeWidth: true })).toHaveLength(1)
  })

  test('flags a match on part of a character NFKC expands', () => {
    const [match] = createMatcher({
      find: '平',
      options: options({ normalizeWidth: true }),
      replace: 'X',
    }).findAll('㍻元年')
    expect(match).toMatchObject({ partial: true, text: '㍻' })
    expect(ranges('平成', '㍻元年', { normalizeWidth: true })[0]).toMatchObject({ matched: '㍻' })
  })

  test('without normalization full-width does not match', () => {
    expect(ranges('ABC', 'ＡＢＣ')).toEqual([])
  })
})

describe('regex mode', () => {
  test('expands groups in the replacement', () => {
    expect(ranges('(\\d+)円', '100円と2000円', { mode: 'regex' }, '¥$1')).toEqual([
      { end: 4, matched: '100円', replacement: '¥100', start: 0 },
      { end: 10, matched: '2000円', replacement: '¥2000', start: 5 },
    ])
  })

  test('supports named groups, $& and $$', () => {
    expect(ranges('(?<n>b)', 'abc', { mode: 'regex' }, '[$<n>|$&|$$]')[0]?.replacement).toBe('[b|b|$]')
  })

  test('skips empty matches', () => {
    expect(ranges('x*', 'abc', { mode: 'regex' })).toEqual([])
  })

  test('rejects malformed patterns', () => {
    expect(() => ranges('(', 'abc', { mode: 'regex' })).toThrow(InvalidPatternError)
  })

  test('runs patterns that backtrack catastrophically in other engines in linear time', () => {
    const text = `${'a'.repeat(50_000)}!`
    const started = Date.now()
    for (const pattern of ['(a+)+$', 'a+a+a+$', '(a|aa)+$']) {
      expect(ranges(pattern, text, { mode: 'regex' })).toEqual([])
    }
    expect(Date.now() - started).toBeLessThan(2000)
  })

  test('rejects syntax RE2 does not support', () => {
    expect(() => ranges('(a)\\1', 'aa', { mode: 'regex' })).toThrow(InvalidPatternError)
    expect(() => ranges('(?=a)', 'a', { mode: 'regex' })).toThrow(InvalidPatternError)
  })

  test('advances past empty matches on astral characters', () => {
    expect(ranges('x*', '😀a😀', { mode: 'regex' })).toEqual([])
  })

  test('$nn falls back to $n followed by a digit like String.prototype.replace', () => {
    expect(ranges('(a)', 'a', { mode: 'regex' }, '$12')[0]?.replacement).toBe('a2')
    expect(ranges('(a)', 'a', { mode: 'regex' }, '$0')[0]?.replacement).toBe('$0')
  })

  test('$<name> expands a named group', () => {
    expect(ranges('(?P<yen>\\d+)円', '500円', { mode: 'regex' }, '¥$<yen>')[0]?.replacement).toBe('¥500')
  })

  test('$<name> stays literal when the pattern has no named groups', () => {
    expect(ranges('(a)', 'a', { mode: 'regex' }, '$<x>')[0]?.replacement).toBe('$<x>')
  })
})

test('rejects an empty search text', () => {
  expect(() => ranges('', 'abc')).toThrow(InvalidPatternError)
})

describe('foldCase', () => {
  test.each([
    ['ſ', 's'],
    ['ς', 'σ'],
    ['Σ', 'σ'],
    ['\u212A', 'k'],
    ['ᲀ', 'в'],
    ['ß', 'ẞ'],
  ])('%s and %s fold to the same character', (a, b) => {
    expect(foldCase(a)).toBe(foldCase(b))
  })

  test('keeps length per character', () => {
    expect(foldCase('ΟΔΟΣ Straße')).toHaveLength('ΟΔΟΣ Straße'.length)
  })
})
