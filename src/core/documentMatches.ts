import type { Field, Payload } from 'payload'

import type { FieldFilter } from '../types.js'
import type { Matcher, TextMatch } from './matcher.js'
import type { TextEntry } from './textFields.js'

import {
  applyLexicalReplacements,
  collectTextRuns,
  type LexicalReplacement,
  locateInRun,
  OBJECT_PLACEHOLDER,
} from './lexical.js'
import { collectTextEntries, getAtPath, setAtPath } from './textFields.js'

const CONTEXT_LENGTH = 40

/** One match as shown in the preview. */
export type DocumentMatch = {
  after: string
  before: string
  /** The field's label in the request language, when the caller resolves it. */
  fieldLabel?: string
  /** Concrete path, e.g. `layout.0.content`. */
  fieldPath: string
  /** Stable within one version of the document: field path, node path and offsets. */
  id: string
  /** Why the match has to be fixed by hand. Unset when it can be replaced. */
  reason?: ManualReason
  /** `false` when the match has to be fixed by hand; see `reason`. */
  replaceable: boolean
  replacement: string
  schemaPath: string
  text: string
}

/**
 * - `crossesNodes`: spans several rich text nodes (bold, link boundaries…)
 * - `partialCharacter`: covers part of a character NFKC expands (e.g. `平` in `㍻`)
 */
export type ManualReason = 'crossesNodes' | 'partialCharacter'

type Location =
  | { kind: 'lexical'; replacement: LexicalReplacement }
  | { kind: 'manual' }
  | { kind: 'plain'; match: TextMatch }

type LocatedMatch = { entry: TextEntry; location: Location; public: DocumentMatch }

const forDisplay = (text: string) => text.replaceAll(OBJECT_PLACEHOLDER, ' ')

const context = (text: string, match: TextMatch) => ({
  after: forDisplay(text.slice(match.end, match.end + CONTEXT_LENGTH)),
  before: forDisplay(text.slice(Math.max(0, match.start - CONTEXT_LENGTH), match.start)),
})

const locateMatches = ({
  collection,
  doc,
  filter,
  matcher,
  payload,
}: {
  collection: string
  doc: unknown
  filter: FieldFilter | undefined
  matcher: Matcher
  payload: Payload
}): LocatedMatch[] => {
  const located: LocatedMatch[] = []

  for (const entry of collectTextEntries({ collection, doc, filter, payload })) {
    const fieldPath = entry.path.join('.')

    if (entry.type !== 'richText') {
      const text = entry.value as string
      for (const match of matcher.findAll(text)) {
        located.push({
          entry,
          location: match.partial ? { kind: 'manual' } : { kind: 'plain', match },
          public: {
            ...context(text, match),
            id: `${fieldPath}~~${match.start}-${match.end}`,
            fieldPath,
            ...(match.partial ? { reason: 'partialCharacter' as const } : {}),
            replaceable: !match.partial,
            replacement: match.replacement,
            schemaPath: entry.schemaPath,
            text: forDisplay(match.text),
          },
        })
      }
      continue
    }

    collectTextRuns(entry.value).forEach((run, runIndex) => {
      for (const match of matcher.findAll(run.text)) {
        const where = locateInRun(run, match)
        const base = {
          ...context(run.text, match),
          fieldPath,
          replacement: match.replacement,
          schemaPath: entry.schemaPath,
          text: forDisplay(match.text),
        }
        if (where.crossesNodes || match.partial) {
          located.push({
            entry,
            location: { kind: 'manual' },
            public: {
              ...base,
              id: `${fieldPath}~run${runIndex}~${match.start}-${match.end}`,
              reason: where.crossesNodes ? 'crossesNodes' : 'partialCharacter',
              replaceable: false,
            },
          })
        } else {
          located.push({
            entry,
            location: {
              kind: 'lexical',
              replacement: {
                localEnd: where.localEnd,
                localStart: where.localStart,
                nodePath: where.nodePath,
                original: match.text,
                replacement: match.replacement,
              },
            },
            public: {
              ...base,
              id: `${fieldPath}~${where.nodePath.join('.')}~${where.localStart}-${where.localEnd}`,
              replaceable: true,
            },
          })
        }
      }
    })
  }

  return located
}

export const findDocumentMatches = ({
  labelOf,
  ...args
}: { labelOf?: (field: Field) => string | undefined } & Parameters<typeof locateMatches>[0]): DocumentMatch[] =>
  locateMatches(args).map((match) => {
    const fieldLabel = labelOf?.(match.entry.field)
    return fieldLabel ? { ...match.public, fieldLabel } : match.public
  })

/** The new value planned for one field and the matches it contains. */
export type PlannedChange = {
  ids: string[]
  path: (number | string)[]
  value: unknown
}

/**
 * Applies the selected matches to a copy of `doc` and returns only the top-level fields that
 * changed, ready for `payload.update`, plus the planned value of each changed field so the
 * caller can check what was actually saved. Ids that are no longer found (the document changed
 * since the preview) or that need manual fixing are returned in `skippedIds`.
 */
export const applyDocumentMatches = ({
  matchIds,
  ...args
}: { matchIds: string[] } & Parameters<typeof locateMatches>[0]): {
  changes: PlannedChange[]
  data: Record<string, unknown>
  skippedIds: string[]
} => {
  const wanted = new Set(matchIds)
  const located = locateMatches(args).filter(
    (match) => wanted.has(match.public.id) && match.location.kind !== 'manual',
  )

  const copy = structuredClone(args.doc)
  const byEntry = new Map<string, LocatedMatch[]>()
  for (const match of located) {
    const key = match.entry.path.join('.')
    byEntry.set(key, [...(byEntry.get(key) ?? []), match])
  }

  const changes: PlannedChange[] = []
  const touchedKeys = new Set<string>()

  for (const matches of byEntry.values()) {
    const entry = matches[0].entry
    const appliedIds: string[] = []

    if (entry.type === 'richText') {
      const replacements = matches.flatMap((match) =>
        match.location.kind === 'lexical' ? [match.location.replacement] : [],
      )
      const { skipped, value } = applyLexicalReplacements(getAtPath(copy, entry.path), replacements)
      setAtPath(copy, entry.path, value)
      for (const match of matches) {
        if (match.location.kind === 'lexical' && !skipped.includes(match.location.replacement)) {
          appliedIds.push(match.public.id)
        }
      }
    } else {
      let text = getAtPath(copy, entry.path) as string
      const ordered = [...matches].sort((a, b) => {
        const startA = a.location.kind === 'plain' ? a.location.match.start : 0
        const startB = b.location.kind === 'plain' ? b.location.match.start : 0
        return startB - startA
      })
      for (const match of ordered) {
        if (match.location.kind === 'plain') {
          const { end, replacement, start } = match.location.match
          text = text.slice(0, start) + replacement + text.slice(end)
          appliedIds.push(match.public.id)
        }
      }
      setAtPath(copy, entry.path, text)
    }

    if (appliedIds.length) {
      changes.push({ ids: appliedIds, path: entry.path, value: getAtPath(copy, entry.path) })
      touchedKeys.add(String(entry.path[0]))
    }
  }

  const data: Record<string, unknown> = {}
  for (const key of touchedKeys) {
    data[key] = (copy as Record<string, unknown>)[key]
  }

  const applied = new Set(changes.flatMap((change) => change.ids))
  return {
    changes,
    data,
    skippedIds: matchIds.filter((id) => !applied.has(id)),
  }
}
