import type { Block, CollectionSlug, Field, Payload } from 'payload'

import { fieldAffectsData, fieldIsVirtual, tabHasName } from 'payload/shared'

import type { FieldFilter } from '../types.js'

export type TextFieldType = 'richText' | 'text' | 'textarea'

/** A location in a document that holds searchable text. */
export type TextEntry = {
  field: Field
  /** Concrete path to the value, with array/block indices, e.g. `['layout', 0, 'content']`. */
  path: (number | string)[]
  /** Field names only, without indices, e.g. `layout.content`. Used by include/exclude filters. */
  schemaPath: string
  type: TextFieldType
  /** A string for text/textarea, a Lexical editor state for richText. */
  value: unknown
}

type WalkArgs = {
  collection: string
  data: unknown
  fields: Field[]
  filter: FieldFilter | undefined
  /** An enclosing field is hidden from the admin panel, so everything inside it is too. */
  hidden?: boolean
  out: TextEntry[]
  path: (number | string)[]
  payload: Payload
  schemaPath: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Matches a dot path against a glob where `*` is one segment and `**` is zero or more. */
export const matchesPathGlob = (pattern: string, schemaPath: string): boolean => {
  const patternSegments = pattern.split('.')
  const pathSegments = schemaPath.split('.')

  const match = (p: number, s: number): boolean => {
    if (p === patternSegments.length) {
      return s === pathSegments.length
    }
    const segment = patternSegments[p]
    if (segment === '**') {
      for (let skip = s; skip <= pathSegments.length; skip++) {
        if (match(p + 1, skip)) {
          return true
        }
      }
      return false
    }
    if (s === pathSegments.length) {
      return false
    }
    return (segment === '*' || segment === pathSegments[s]) && match(p + 1, s + 1)
  }

  return match(0, 0)
}

/**
 * Fields left out unless the host passes its own `exclude`. Besides slugs and URLs, these are
 * fields that official Payload plugins add to the host's collections and fill in themselves:
 * replacing their text changes nothing, or breaks the link to another system.
 */
export const DEFAULT_EXCLUDE = [
  '**.slug',
  '**.url',
  // @payloadcms/plugin-nested-docs: rebuilt from the parent chain on every save.
  'breadcrumbs.**',
  // @payloadcms/plugin-stripe: the id of the synced Stripe object.
  'stripeID',
]

/**
 * Hidden from the admin panel (`hidden`, `admin.hidden` or `admin.disabled`): editors can't see the
 * value or what a replacement did to it. Covers Payload's own upload fields (`filename`,
 * `mimeType`, `sizes`…) and those of the storage plugins (`prefix`).
 */
const isHiddenField = (field: Field): boolean => {
  if ('hidden' in field && field.hidden === true) {
    return true
  }
  const admin = (field as { admin?: { disabled?: boolean; hidden?: boolean } }).admin
  return admin?.hidden === true || admin?.disabled === true
}

const isIncluded = ({
  collection,
  field,
  filter,
  hidden,
  schemaPath,
}: {
  collection: string
  field: Field
  filter: FieldFilter | undefined
  hidden: boolean
  schemaPath: string
}): boolean => {
  if (typeof filter?.include === 'function') {
    const result = filter.include({ collection, field, schemaPath })
    if (typeof result === 'boolean') {
      return result
    }
  }
  if (hidden) {
    return false
  }
  const exclude = filter?.exclude ?? DEFAULT_EXCLUDE
  return !exclude.some((pattern) => matchesPathGlob(pattern, schemaPath))
}

const resolveBlocks = (field: Field, payload: Payload): Block[] => {
  if (field.type !== 'blocks') {
    return []
  }
  const references = (field.blockReferences ?? []).map((ref) =>
    typeof ref === 'string' ? payload.config.blocks?.find((block) => block.slug === ref) : ref,
  )
  return [...(field.blocks ?? []), ...references].filter((block): block is Block => Boolean(block))
}

const walkFields = (args: WalkArgs): void => {
  const { collection, data, fields, filter, out, path, payload, schemaPath } = args
  if (!isRecord(data)) {
    return
  }

  for (const field of fields) {
    if (fieldIsVirtual(field)) {
      continue
    }
    const hidden = Boolean(args.hidden) || isHiddenField(field)

    // Layout-only fields: their children live on the same data object.
    if (field.type === 'row' || field.type === 'collapsible') {
      walkFields({ ...args, fields: field.fields, hidden })
      continue
    }

    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        if (tabHasName(tab)) {
          walkFields({
            ...args,
            data: data[tab.name],
            fields: tab.fields,
            hidden,
            path: [...path, tab.name],
            schemaPath: [...schemaPath, tab.name],
          })
        } else {
          walkFields({ ...args, fields: tab.fields, hidden })
        }
      }
      continue
    }

    if (field.type === 'group') {
      if ('name' in field && field.name) {
        walkFields({
          ...args,
          data: data[field.name],
          fields: field.fields,
          hidden,
          path: [...path, field.name],
          schemaPath: [...schemaPath, field.name],
        })
      } else {
        walkFields({ ...args, fields: field.fields, hidden })
      }
      continue
    }

    if (!fieldAffectsData(field)) {
      continue
    }

    const value = data[field.name]
    const fieldPath = [...path, field.name]
    const fieldSchemaPath = [...schemaPath, field.name]

    if (field.type === 'array' && Array.isArray(value)) {
      value.forEach((row, index) => {
        walkFields({
          ...args,
          data: row,
          fields: field.fields,
          hidden,
          path: [...fieldPath, index],
          schemaPath: fieldSchemaPath,
        })
      })
      continue
    }

    if (field.type === 'blocks' && Array.isArray(value)) {
      const blocks = resolveBlocks(field, payload)
      value.forEach((row, index) => {
        const blockType = isRecord(row) ? row.blockType : undefined
        const block = blocks.find((candidate) => candidate.slug === blockType)
        if (block) {
          walkFields({
            ...args,
            data: row,
            fields: block.fields,
            hidden,
            path: [...fieldPath, index],
            schemaPath: fieldSchemaPath,
          })
        }
      })
      continue
    }

    if (field.type !== 'text' && field.type !== 'textarea' && field.type !== 'richText') {
      continue
    }

    const joinedSchemaPath = fieldSchemaPath.join('.')
    if (!isIncluded({ collection, field, filter, hidden, schemaPath: joinedSchemaPath })) {
      continue
    }

    if (field.type === 'richText') {
      if (isRecord(value) && isRecord(value.root)) {
        out.push({ type: 'richText', field, path: fieldPath, schemaPath: joinedSchemaPath, value })
      }
      continue
    }

    if (typeof value === 'string') {
      out.push({ type: field.type, field, path: fieldPath, schemaPath: joinedSchemaPath, value })
    } else if (Array.isArray(value)) {
      // `hasMany` text fields store an array of strings.
      value.forEach((item, index) => {
        if (typeof item === 'string') {
          out.push({
            type: field.type as TextFieldType,
            field,
            path: [...fieldPath, index],
            schemaPath: joinedSchemaPath,
            value: item,
          })
        }
      })
    }
  }
}

/** Lists every text, textarea and richText value in a document that the filter allows. */
export const collectTextEntries = ({
  collection,
  doc,
  filter,
  payload,
}: {
  collection: string
  doc: unknown
  filter: FieldFilter | undefined
  payload: Payload
}): TextEntry[] => {
  const fields = payload.collections[collection]?.config.fields ?? []
  const out: TextEntry[] = []
  walkFields({ collection, data: doc, fields, filter, out, path: [], payload, schemaPath: [] })
  return out
}

export const getAtPath = (data: unknown, path: (number | string)[]): unknown =>
  path.reduce<unknown>((current, key) => {
    if (current === null || typeof current !== 'object') {
      return undefined
    }
    return (current as Record<number | string, unknown>)[key]
  }, data)

export const setAtPath = (data: unknown, path: (number | string)[], value: unknown): void => {
  const parent = getAtPath(data, path.slice(0, -1))
  if (parent !== null && typeof parent === 'object') {
    ;(parent as Record<number | string, unknown>)[path[path.length - 1]] = value
  }
}
