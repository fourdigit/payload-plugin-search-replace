import type { Endpoint, PayloadRequest, TypedFallbackLocale, TypedLocale, Where } from 'payload'

import { headersWithCors } from 'payload'

import type { SanitizedSearchPluginConfig } from '../types.js'

import {
  applyDocumentMatches,
  type DocumentMatch,
  findDocumentMatches,
} from '../core/documentMatches.js'
import {
  createMatcher,
  foldForIndex,
  InvalidPatternError,
  type Matcher,
  normalizeForIndex,
} from '../core/matcher.js'
import { getAtPath } from '../core/textFields.js'
import { defaultReplaceAccess } from '../defaultAccess.js'

export const ENDPOINT_BASE = '/search-replace'

export type SearchReplaceQuery = {
  caseSensitive?: boolean
  /** Limit to some of the plugin's collections. Defaults to all of them. */
  collections?: string[]
  find: string
  locale?: string
  mode?: 'regex' | 'text'
  normalizeWidth?: boolean
  replace?: string
}

export type PreviewDocument = {
  collection: string
  id: number | string
  matches: DocumentMatch[]
  title?: string
  updatedAt?: string
}

export type PreviewResponse = {
  documents: PreviewDocument[]
  totals: { documents: number; manual: number; matches: number }
}

export type ApplyRequest = {
  documents: {
    collection: string
    id: number | string
    matchIds: string[]
    /** `updatedAt` from the preview. A document changed since then is skipped. */
    updatedAt?: string
  }[]
} & SearchReplaceQuery

export type ApplyResult = {
  appliedIds: string[]
  collection: string
  id: number | string
  message?: string
  /** Selected matches that were not replaced: changed since the preview, need manual fixing, or not saved (field access). */
  skippedIds: string[]
  status: 'error' | 'stale' | 'unchanged' | 'updated'
}

export type ApplyResponse = { results: ApplyResult[] }

export type CapabilitiesResponse = {
  canUseRegex: boolean
  collections: string[]
  maxApplyDocs?: number
}

const ID_CHUNK = 100

const NO_FALLBACK = false as unknown as TypedFallbackLocale
type AnyDoc = Record<string, unknown>

class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

const json = (req: PayloadRequest, body: unknown, status = 200) =>
  Response.json(body, { headers: headersWithCors({ headers: new Headers(), req }), status })

const assertAccess = async (req: PayloadRequest, pluginConfig: SanitizedSearchPluginConfig) => {
  const access = pluginConfig.replace?.access ?? defaultReplaceAccess
  if (!(await access({ req }))) {
    throw new HttpError(req.t('error:notAllowedToPerformAction'), req.user ? 403 : 401)
  }
}

const canUseRegex = async (req: PayloadRequest, pluginConfig: SanitizedSearchPluginConfig) =>
  Boolean(await pluginConfig.replace?.canUseRegex?.({ req }))

const readBody = async (req: PayloadRequest): Promise<Record<string, unknown>> => {
  if (!req.json) {
    throw new HttpError('Missing request body.', 400)
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new HttpError('The request body is not valid JSON.', 400)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError('The request body must be an object.', 400)
  }
  return body as Record<string, unknown>
}

const optionalString = (value: unknown, name: string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new HttpError(`\`${name}\` must be a string.`, 400)
  }
  return value
}

const parseQuery = (body: Record<string, unknown>): SearchReplaceQuery => {
  const find = optionalString(body.find, 'find')
  if (!find) {
    throw new HttpError('`find` is required.', 400)
  }
  if (
    body.collections !== undefined &&
    !(Array.isArray(body.collections) && body.collections.every((slug) => typeof slug === 'string'))
  ) {
    throw new HttpError('`collections` must be an array of strings.', 400)
  }
  return {
    caseSensitive: body.caseSensitive === true,
    collections: body.collections,
    find,
    locale: optionalString(body.locale, 'locale'),
    mode: body.mode === 'regex' ? 'regex' : 'text',
    normalizeWidth: body.normalizeWidth === true,
    replace: optionalString(body.replace, 'replace') ?? '',
  }
}

const parseTargets = (body: Record<string, unknown>): ApplyRequest['documents'] => {
  const { documents } = body
  const isTarget = (value: unknown): value is ApplyRequest['documents'][number] => {
    if (typeof value !== 'object' || value === null) {
      return false
    }
    const target = value as Record<string, unknown>
    return (
      typeof target.collection === 'string' &&
      (typeof target.id === 'string' || typeof target.id === 'number') &&
      Array.isArray(target.matchIds) &&
      target.matchIds.every((id) => typeof id === 'string') &&
      (target.updatedAt === undefined || typeof target.updatedAt === 'string')
    )
  }
  if (!Array.isArray(documents) || !documents.every(isTarget)) {
    throw new HttpError(
      '`documents` must be an array of { collection, id, matchIds: string[], updatedAt? }.',
      400,
    )
  }
  return documents
}

type ResolvedQuery = {
  collections: string[]
  locale: TypedLocale | undefined
  matcher: Matcher
  query: SearchReplaceQuery
}

const resolveQuery = async (
  req: PayloadRequest,
  pluginConfig: SanitizedSearchPluginConfig,
  query: SearchReplaceQuery,
): Promise<ResolvedQuery> => {
  if (query.mode === 'regex' && !(await canUseRegex(req, pluginConfig))) {
    throw new HttpError('You are not allowed to search with regular expressions.', 403)
  }

  const allowed = pluginConfig.collections ?? []
  const collections = query.collections?.length
    ? query.collections.filter((slug) => allowed.includes(slug))
    : allowed
  if (!collections.length) {
    throw new HttpError('No searchable collections were selected.', 400)
  }

  const localization = req.payload.config.localization
  let locale: TypedLocale | undefined
  if (localization) {
    const code = query.locale ?? localization.defaultLocale
    if (!localization.localeCodes.includes(code)) {
      throw new HttpError(`Unknown locale "${code}".`, 400)
    }
    locale = code as unknown as TypedLocale
  }

  try {
    const matcher = createMatcher({
      find: query.find,
      options: {
        caseSensitive: Boolean(query.caseSensitive),
        mode: query.mode ?? 'text',
        normalizeWidth: Boolean(query.normalizeWidth),
      },
      replace: query.replace ?? '',
    })
    return { collections, locale, matcher, query }
  } catch (err) {
    if (err instanceof InvalidPatternError) {
      throw new HttpError(err.message, 400)
    }
    throw err
  }
}

const isDraftsEnabled = (req: PayloadRequest, collection: string) =>
  Boolean(req.payload.collections[collection]?.config.versions?.drafts)

/** Reads documents as the current user, latest version, without locale fallback. */
const readDocuments = async (
  req: PayloadRequest,
  { collection, locale, where }: { collection: string; locale: TypedLocale | undefined; where?: Where },
  onPage: (docs: AnyDoc[]) => void,
) => {
  let page = 1
  for (;;) {
    let result
    try {
      result = await req.payload.find({
        collection,
        depth: 0,
        draft: isDraftsEnabled(req, collection),
        fallbackLocale: NO_FALLBACK,
        limit: ID_CHUNK,
        locale,
        overrideAccess: false,
        page,
        req,
        sort: 'id',
        user: req.user,
        where,
      })
    } catch (err) {
      // No read access to the collection at all: nothing to show from it.
      if ((err as { status?: number } | null)?.status === 403) {
        return
      }
      throw err
    }
    onPage(result.docs as unknown as AnyDoc[])
    if (!result.hasNextPage) {
      return
    }
    page++
  }
}

/**
 * Ids of documents whose index text contains the search text, or `undefined` when the index
 * cannot narrow the search safely: regular expressions and backslashes (an escape character in
 * SQL LIKE).
 */
const findCandidateIds = async (
  req: PayloadRequest,
  pluginConfig: SanitizedSearchPluginConfig,
  { collections, locale, matcher, query }: ResolvedQuery,
): Promise<Map<string, Set<number | string>> | undefined> => {
  if (matcher.options.mode === 'regex') {
    return undefined
  }
  const needle = matcher.options.normalizeWidth ? normalizeForIndex(query.find) : foldForIndex(query.find)
  if (needle.includes('\\')) {
    return undefined
  }

  const searchSlug = pluginConfig.searchOverrides?.slug || 'search'
  const byCollection = new Map<string, Set<number | string>>()
  const where: Where = {
    and: [
      // Polymorphic relationTo supports `equals` on SQL adapters, not `in`.
      { or: collections.map((collection) => ({ 'doc.relationTo': { equals: collection } })) },
      matcher.options.normalizeWidth
        ? { content: { contains: needle } }
        : { contentRaw: { contains: needle } },
    ],
  }

  let page = 1
  for (;;) {
    const result = await req.payload.find({
      collection: searchSlug,
      depth: 0,
      limit: 500,
      locale,
      overrideAccess: true,
      page,
      req,
      select: { doc: true },
      // A unique sort keeps pages stable; the default (-createdAt) ties for rows created together.
      sort: 'id',
      where,
    })
    for (const row of result.docs as unknown as {
      doc?: { relationTo: string; value: { id: number | string } | number | string }
    }[]) {
      if (!row.doc) {
        continue
      }
      const value = typeof row.doc.value === 'object' ? row.doc.value.id : row.doc.value
      let ids = byCollection.get(row.doc.relationTo)
      if (!ids) {
        ids = new Set()
        byCollection.set(row.doc.relationTo, ids)
      }
      ids.add(value)
    }
    if (!result.hasNextPage) {
      return byCollection
    }
    page++
  }
}

const titleOf = (req: PayloadRequest, collection: string, doc: AnyDoc) => {
  const useAsTitle = req.payload.collections[collection]?.config.admin?.useAsTitle
  const title = useAsTitle ? doc[useAsTitle] : undefined
  return typeof title === 'string' || typeof title === 'number' ? String(title) : undefined
}

const handleError = (req: PayloadRequest, err: unknown) => {
  if (err instanceof HttpError) {
    return json(req, { message: err.message }, err.status)
  }
  req.payload.logger.error({ err, msg: 'Search & replace failed.' })
  return json(req, { message: req.t('error:unknown') }, 500)
}

/** A user-facing message for one document that failed to update. Details go to the log. */
const describeDocumentError = (req: PayloadRequest, err: unknown): string => {
  const status = (err as { status?: number } | null)?.status
  if (status === 403) {
    return req.t('error:notAllowedToPerformAction')
  }
  if (status === 404) {
    return req.t('error:notFound')
  }
  if (status === 400 && err instanceof Error) {
    // Validation errors are meant for editors.
    return err.message
  }
  return req.t('error:unknown')
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export const createSearchReplaceEndpoints = (pluginConfig: SanitizedSearchPluginConfig): Endpoint[] => [
  {
    handler: async (req) => {
      try {
        await assertAccess(req, pluginConfig)
        const body: CapabilitiesResponse = {
          canUseRegex: await canUseRegex(req, pluginConfig),
          collections: pluginConfig.collections ?? [],
          maxApplyDocs: pluginConfig.replace?.maxApplyDocs,
        }
        return json(req, body)
      } catch (err) {
        return handleError(req, err)
      }
    },
    method: 'get',
    path: `${ENDPOINT_BASE}/capabilities`,
  },
  {
    handler: async (req) => {
      try {
        await assertAccess(req, pluginConfig)
        const resolved = await resolveQuery(req, pluginConfig, parseQuery(await readBody(req)))
        const candidates = await findCandidateIds(req, pluginConfig, resolved)

        const documents: PreviewDocument[] = []
        for (const collection of resolved.collections) {
          const ids = candidates ? [...(candidates.get(collection) ?? [])] : undefined
          if (ids && !ids.length) {
            continue
          }

          const collect = (docs: AnyDoc[]) => {
            for (const doc of docs) {
              const matches = findDocumentMatches({
                collection,
                doc,
                filter: pluginConfig.fields,
                matcher: resolved.matcher,
                payload: req.payload,
              })
              if (matches.length) {
                documents.push({
                  id: doc.id as number | string,
                  collection,
                  matches,
                  title: titleOf(req, collection, doc),
                  updatedAt: doc.updatedAt as string | undefined,
                })
              }
            }
          }

          if (ids) {
            for (let i = 0; i < ids.length; i += ID_CHUNK) {
              await readDocuments(
                req,
                { collection, locale: resolved.locale, where: { id: { in: ids.slice(i, i + ID_CHUNK) } } },
                collect,
              )
            }
          } else {
            await readDocuments(req, { collection, locale: resolved.locale }, collect)
          }
        }

        const matches = documents.flatMap((doc) => doc.matches)
        const body: PreviewResponse = {
          documents,
          totals: {
            documents: documents.length,
            manual: matches.filter((match) => !match.replaceable).length,
            matches: matches.length,
          },
        }
        return json(req, body)
      } catch (err) {
        return handleError(req, err)
      }
    },
    method: 'post',
    path: `${ENDPOINT_BASE}/preview`,
  },
  {
    handler: async (req) => {
      try {
        await assertAccess(req, pluginConfig)
        const body = await readBody(req)
        const resolved = await resolveQuery(req, pluginConfig, parseQuery(body))

        const targets = parseTargets(body).filter(
          (doc) => resolved.collections.includes(doc.collection) && doc.matchIds.length,
        )
        const { maxApplyDocs } = pluginConfig.replace ?? {}
        if (maxApplyDocs !== undefined && targets.length > maxApplyDocs) {
          throw new HttpError(
            `Too many documents: ${targets.length}. The limit is ${maxApplyDocs} per request.`,
            400,
          )
        }

        const results: ApplyResult[] = []
        for (const target of targets) {
          const base = { id: target.id, collection: target.collection }
          const draft = isDraftsEnabled(req, target.collection)
          try {
            const doc = (await req.payload.findByID({
              id: target.id,
              collection: target.collection,
              depth: 0,
              draft,
              fallbackLocale: NO_FALLBACK,
              locale: resolved.locale,
              overrideAccess: false,
              req,
              user: req.user,
            })) as unknown as AnyDoc

            if (target.updatedAt && doc.updatedAt !== target.updatedAt) {
              results.push({
                ...base,
                appliedIds: [],
                message: 'The document changed after the preview. Run the search again.',
                skippedIds: target.matchIds,
                status: 'stale',
              })
              continue
            }

            const { changes, data, skippedIds } = applyDocumentMatches({
              collection: target.collection,
              doc,
              filter: pluginConfig.fields,
              matcher: resolved.matcher,
              matchIds: target.matchIds,
              payload: req.payload,
            })

            if (!changes.length) {
              results.push({ ...base, appliedIds: [], skippedIds, status: 'unchanged' })
              continue
            }

            const saved = (await req.payload.update({
              id: target.id,
              collection: target.collection,
              data: data as never,
              depth: 0,
              // Save as a draft so the published version only changes through the normal workflow.
              draft,
              locale: resolved.locale,
              overrideAccess: false,
              req,
              user: req.user,
            })) as unknown as AnyDoc

            // Field-level update access can silently keep the old value: count only what was saved.
            const appliedIds: string[] = []
            const notSaved: string[] = []
            for (const change of changes) {
              ;(sameValue(getAtPath(saved, change.path), change.value) ? appliedIds : notSaved).push(
                ...change.ids,
              )
            }

            results.push({
              ...base,
              appliedIds,
              skippedIds: [...skippedIds, ...notSaved],
              status: appliedIds.length ? 'updated' : 'unchanged',
            })
          } catch (err) {
            req.payload.logger.error({
              err,
              msg: `Search & replace: could not update ${target.collection} ${target.id}.`,
            })
            results.push({
              ...base,
              appliedIds: [],
              message: describeDocumentError(req, err),
              skippedIds: target.matchIds,
              status: 'error',
            })
          }
        }

        const response: ApplyResponse = { results }
        return json(req, response)
      } catch (err) {
        return handleError(req, err)
      }
    },
    method: 'post',
    path: `${ENDPOINT_BASE}/apply`,
  },
]
