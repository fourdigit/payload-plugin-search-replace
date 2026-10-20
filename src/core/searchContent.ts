import type { Payload } from 'payload'

import type { FieldFilter } from '../types.js'

import { lexicalToPlainText } from './lexical.js'
import { foldForIndex, normalizeForIndex } from './matcher.js'
import { collectTextEntries } from './textFields.js'

/**
 * Plain text of every indexed field, one field per line, in two forms: `content` (NFKC +
 * case-folded) narrows candidates when width is ignored, `contentRaw` (case-folded only) when
 * it is not. A `contains` query with the search text folded the same way returns a superset of
 * the documents that match.
 */
export const buildSearchContent = ({
  collection,
  doc,
  filter,
  payload,
}: {
  collection: string
  doc: unknown
  filter: FieldFilter | undefined
  payload: Payload
}): { content: string; contentRaw: string } => {
  const text = collectTextEntries({ collection, doc, filter, payload })
    .map((entry) => (entry.type === 'richText' ? lexicalToPlainText(entry.value) : (entry.value as string)))
    .filter(Boolean)
    .join('\n')
  return { content: normalizeForIndex(text), contentRaw: foldForIndex(text) }
}
