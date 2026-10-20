import { describe, expect, test } from 'vitest'

import { applyLexicalReplacements, collectTextRuns, lexicalToPlainText, locateInRun } from './lexical.js'
import { createMatcher } from './matcher.js'

const text = (value: string, format = 0) => ({ type: 'text', format, text: value, version: 1 })
const paragraph = (...children: object[]) => ({ type: 'paragraph', children, version: 1 })
const state = (...children: object[]) => ({ root: { type: 'root', children, version: 1 } })

const editorState = state(
  paragraph(text('Hello '), text('wor', 1), text('ld'), { type: 'linebreak', version: 1 }, text('again')),
  paragraph(text('See '), { type: 'link', children: [text('the docs')], fields: {}, version: 1 }, text('.')),
  {
    type: 'list',
    children: [{ type: 'listitem', children: [text('item one')], version: 1 }],
    version: 1,
  },
)

describe('collectTextRuns', () => {
  test('joins inline text per block, links included, nested blocks separate', () => {
    expect(collectTextRuns(editorState).map((run) => run.text)).toEqual([
      'Hello world\nagain',
      'See the docs.',
      'item one',
    ])
  })

  test('plain text has one line per run', () => {
    expect(lexicalToPlainText(editorState)).toBe('Hello world\nagain\nSee the docs.\nitem one')
  })
})

describe('locateInRun', () => {
  const find = (needle: string, runIndex: number) => {
    const run = collectTextRuns(editorState)[runIndex]
    const match = createMatcher({
      find: needle,
      options: { caseSensitive: true, mode: 'text', normalizeWidth: false },
      replace: '',
    }).findAll(run.text)[0]
    return locateInRun(run, match)
  }

  test('a match inside one node has local offsets', () => {
    expect(find('ello', 0)).toEqual({ crossesNodes: false, localEnd: 5, localStart: 1, nodePath: [0, 0] })
  })

  test('a match inside a link points into the link', () => {
    expect(find('docs', 1)).toEqual({ crossesNodes: false, localEnd: 8, localStart: 4, nodePath: [1, 1, 0] })
  })

  test('a match across formatting is reported as crossing nodes', () => {
    expect(find('world', 0)).toEqual({ crossesNodes: true })
  })

  test('a match across a line break crosses nodes', () => {
    expect(find('ld\nag', 0)).toEqual({ crossesNodes: true })
  })
})

describe('applyLexicalReplacements', () => {
  test('replaces inside the node and keeps formatting and the original untouched', () => {
    const { skipped, value } = applyLexicalReplacements(editorState, [
      { localEnd: 5, localStart: 0, nodePath: [0, 0], original: 'Hello', replacement: 'Hi' },
      { localEnd: 8, localStart: 4, nodePath: [1, 1, 0], original: 'docs', replacement: 'guide' },
    ])
    expect(skipped).toEqual([])
    expect(lexicalToPlainText(value)).toBe('Hi world\nagain\nSee the guide.\nitem one')
    expect(lexicalToPlainText(editorState)).toBe('Hello world\nagain\nSee the docs.\nitem one')
  })

  test('applies several replacements in one node from the end', () => {
    const doc = state(paragraph(text('a-a-a')))
    const { value } = applyLexicalReplacements(doc, [
      { localEnd: 1, localStart: 0, nodePath: [0, 0], original: 'a', replacement: 'bb' },
      { localEnd: 3, localStart: 2, nodePath: [0, 0], original: 'a', replacement: 'bb' },
      { localEnd: 5, localStart: 4, nodePath: [0, 0], original: 'a', replacement: 'bb' },
    ])
    expect(lexicalToPlainText(value)).toBe('bb-bb-bb')
  })

  test('skips a replacement whose text changed', () => {
    const { skipped } = applyLexicalReplacements(editorState, [
      { localEnd: 5, localStart: 0, nodePath: [0, 0], original: 'Howdy', replacement: 'Hi' },
    ])
    expect(skipped).toHaveLength(1)
  })
})

test('nodes without text split a run so text around them does not join', () => {
  const doc = state(paragraph(text('foo'), { type: 'inlineBlock', fields: {}, version: 1 }, text('bar')))
  const [run] = collectTextRuns(doc)
  const match = createMatcher({
    find: 'foobar',
    options: { caseSensitive: true, mode: 'text', normalizeWidth: false },
    replace: '',
  }).findAll(run.text)
  expect(match).toEqual([])
  expect(lexicalToPlainText(doc)).toBe('foo bar')
})
