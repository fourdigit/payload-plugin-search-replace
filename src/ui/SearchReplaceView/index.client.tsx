'use client'

import { Button, ConfirmationModal, toast, useConfig, useModal, useTranslation } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import React, { useCallback, useMemo, useState } from 'react'

import type {
  ApplyRequest,
  ApplyResponse,
  PreviewDocument,
  PreviewResponse,
  SearchReplaceQuery,
} from '../../endpoints/searchReplace.js'
import type { TranslationKey } from '../../translations.js'
import type { SearchReplaceClientProps } from './types.js'

import './index.css'

const baseClass = 'search-replace'
const confirmModalSlug = 'search-replace-confirm'

const docKey = (doc: Pick<PreviewDocument, 'collection' | 'id'>) => `${doc.collection}:${doc.id}`

export const SearchReplaceClient: React.FC<SearchReplaceClientProps> = ({
  canUseRegex,
  collections,
  defaultLocale,
  locales,
  maxApplyDocs,
}) => {
  const { config } = useConfig()
  const { openModal } = useModal()
  const { i18n, t: translate } = useTranslation()
  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, unknown>) =>
      (translate as (key: string, vars?: Record<string, unknown>) => string)(
        `plugin-search-replace:${key}`,
        vars,
      ),
    [translate],
  )

  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [mode, setMode] = useState<'regex' | 'text'>('text')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [normalizeWidth, setNormalizeWidth] = useState(false)
  const [locale, setLocale] = useState(defaultLocale)
  const [selectedCollections, setSelectedCollections] = useState(collections.map((c) => c.slug))

  const [searching, setSearching] = useState(false)
  const [applying, setApplying] = useState(false)
  /** The query the current results belong to; apply reuses it so results and replacement match. */
  const [resultQuery, setResultQuery] = useState<SearchReplaceQuery>()
  const [results, setResults] = useState<PreviewResponse>()
  /** Selected match ids per document key. */
  const [selected, setSelected] = useState<Record<string, Set<string>>>({})
  /** What the confirmation dialog will apply, fixed when it opens. */
  const [pending, setPending] = useState<ApplyRequest>()

  const apiURL = useCallback(
    (path: `/${string}`) => formatAdminURL({ apiRoute: config.routes.api, path, serverURL: config.serverURL }),
    [config.routes.api, config.serverURL],
  )

  const editURL = useCallback(
    (doc: PreviewDocument) =>
      formatAdminURL({
        adminRoute: config.routes.admin,
        path: `/collections/${doc.collection}/${doc.id}${resultQuery?.locale ? `?locale=${resultQuery.locale}` : ''}`,
      }),
    [config.routes.admin, resultQuery?.locale],
  )

  const collectionLabel = useMemo(
    () => Object.fromEntries(collections.map((c) => [c.slug, c.label])),
    [collections],
  )

  const post = useCallback(
    async <T,>(path: `/${string}`, body: unknown): Promise<T> => {
      const res = await fetch(apiURL(path), {
        body: JSON.stringify(body),
        credentials: 'include',
        headers: { 'Accept-Language': i18n.language, 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const text = await res.text()
      let json: ({ message?: string } & T) | undefined
      try {
        json = JSON.parse(text) as { message?: string } & T
      } catch {
        // Not JSON, e.g. an HTML error page from a proxy.
      }
      if (!res.ok || !json) {
        throw new Error(json?.message || res.statusText || text.slice(0, 200))
      }
      return json
    },
    [apiURL, i18n.language],
  )

  const runSearch = useCallback(
    async (query: SearchReplaceQuery) => {
      setSearching(true)
      try {
        const response = await post<PreviewResponse>('/search-replace/preview', query)
        setResultQuery(query)
        setResults(response)
        setSelected(
          Object.fromEntries(
            response.documents.map((doc) => [
              docKey(doc),
              new Set(doc.matches.filter((match) => match.replaceable).map((match) => match.id)),
            ]),
          ),
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setSearching(false)
      }
    },
    [post],
  )

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!find) {
      return
    }
    void runSearch({
      caseSensitive,
      collections: selectedCollections,
      find,
      locale,
      mode,
      normalizeWidth,
      replace,
    })
  }

  const selection = useMemo(() => {
    const documents = (results?.documents ?? [])
      .map((doc) => ({ doc, ids: [...(selected[docKey(doc)] ?? [])] }))
      .filter(({ ids }) => ids.length)
    return { documents, matches: documents.reduce((sum, { ids }) => sum + ids.length, 0) }
  }, [results, selected])

  const overLimit = maxApplyDocs !== undefined && selection.documents.length > maxApplyDocs

  const toggleMatch = (doc: PreviewDocument, id: string) =>
    setSelected((current) => {
      const next = new Set(current[docKey(doc)])
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return { ...current, [docKey(doc)]: next }
    })

  const setDocSelected = (doc: PreviewDocument, on: boolean) =>
    setSelected((current) => ({
      ...current,
      [docKey(doc)]: new Set(on ? doc.matches.filter((m) => m.replaceable).map((m) => m.id) : []),
    }))

  const setAllSelected = (on: boolean) =>
    setSelected(
      Object.fromEntries(
        (results?.documents ?? []).map((doc) => [
          docKey(doc),
          new Set(on ? doc.matches.filter((m) => m.replaceable).map((m) => m.id) : []),
        ]),
      ),
    )

  const openConfirm = () => {
    if (!resultQuery) {
      return
    }
    setPending({
      ...resultQuery,
      documents: selection.documents.map(({ doc, ids }) => ({
        id: doc.id,
        collection: doc.collection,
        matchIds: ids,
        updatedAt: doc.updatedAt,
      })),
    })
    openModal(confirmModalSlug)
  }

  const onApply = useCallback(async () => {
    if (!pending) {
      return
    }
    const { documents: _documents, ...query } = pending
    setApplying(true)
    try {
      const { results: applied } = await post<ApplyResponse>('/search-replace/apply', pending)
      const count = (status: string) => applied.filter((result) => result.status === status).length
      // Stale and failed documents are counted on their own; count skipped matches of the rest.
      const skipped = applied
        .filter((result) => result.status === 'updated' || result.status === 'unchanged')
        .reduce((sum, result) => sum + result.skippedIds.length, 0)
      const message = t('applyDone', {
        error: count('error'),
        skipped,
        stale: count('stale'),
        unchanged: count('unchanged'),
        updated: count('updated'),
      })
      if (count('error') || count('stale') || skipped) {
        toast.warning(message)
      } else {
        toast.success(message)
      }
      await runSearch(query)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
      setPending(undefined)
    }
  }, [pending, post, runSearch, t])

  return (
    <div className={baseClass}>
      <h1 className={`${baseClass}__title`}>{t('title')}</h1>

      <form className={`${baseClass}__form`} onSubmit={onSubmit}>
        <label className={`${baseClass}__field`}>
          <span>{t('find')}</span>
          <input
            onChange={(e) => setFind(e.target.value)}
            placeholder={t('findPlaceholder')}
            required
            type="text"
            value={find}
          />
        </label>
        <label className={`${baseClass}__field`}>
          <span>{t('replace')}</span>
          <input
            onChange={(e) => setReplace(e.target.value)}
            placeholder={t('replacePlaceholder')}
            type="text"
            value={replace}
          />
        </label>

        <div className={`${baseClass}__options`}>
          {canUseRegex && (
            <fieldset className={`${baseClass}__group`}>
              <legend>{t('mode')}</legend>
              {(['text', 'regex'] as const).map((value) => (
                <label key={value}>
                  <input
                    checked={mode === value}
                    name="search-replace-mode"
                    onChange={() => setMode(value)}
                    type="radio"
                  />
                  {t(value === 'text' ? 'modeText' : 'modeRegex')}
                </label>
              ))}
            </fieldset>
          )}
          <fieldset className={`${baseClass}__group`}>
            <label>
              <input
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                type="checkbox"
              />
              {t('caseSensitive')}
            </label>
            <label>
              <input
                checked={normalizeWidth}
                onChange={(e) => setNormalizeWidth(e.target.checked)}
                type="checkbox"
              />
              {t('normalizeWidth')}
            </label>
          </fieldset>
          {locales.length > 0 && (
            <label className={`${baseClass}__group`}>
              <span>{t('locale')}</span>
              <select onChange={(e) => setLocale(e.target.value)} value={locale}>
                {locales.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {collections.length > 1 && (
            <fieldset className={`${baseClass}__group`}>
              <legend>{t('collections')}</legend>
              {collections.map((collection) => (
                <label key={collection.slug}>
                  <input
                    checked={selectedCollections.includes(collection.slug)}
                    onChange={(e) =>
                      setSelectedCollections((current) =>
                        e.target.checked
                          ? [...current, collection.slug]
                          : current.filter((slug) => slug !== collection.slug),
                      )
                    }
                    type="checkbox"
                  />
                  {collection.label}
                </label>
              ))}
            </fieldset>
          )}
        </div>
        {mode === 'regex' && <p className={`${baseClass}__help`}>{t('regexHelp')}</p>}

        <Button buttonStyle="primary" disabled={searching || applying || !find || !selectedCollections.length} type="submit">
          {searching ? t('searching') : t('search')}
        </Button>
      </form>

      {results && (
        <section className={`${baseClass}__results`}>
          <div className={`${baseClass}__toolbar`}>
            <p>
              {results.totals.matches
                ? t('summary', {
                    documents: results.totals.documents,
                    manual: results.totals.manual,
                    matches: results.totals.matches,
                  })
                : t('noResults')}
            </p>
            {results.totals.matches > 0 && (
              <div className={`${baseClass}__toolbar-actions`}>
                <Button buttonStyle="secondary" onClick={() => setAllSelected(true)} size="small">
                  {t('selectAll')}
                </Button>
                <Button buttonStyle="secondary" onClick={() => setAllSelected(false)} size="small">
                  {t('deselectAll')}
                </Button>
                <Button
                  buttonStyle="primary"
                  disabled={applying || searching || !selection.matches || overLimit}
                  onClick={openConfirm}
                  size="small"
                >
                  {applying ? t('applying') : `${t('apply')} (${selection.matches})`}
                </Button>
              </div>
            )}
          </div>
          {overLimit && <p className={`${baseClass}__error`}>{t('maxApplyDocs', { max: maxApplyDocs })}</p>}

          {results.documents.map((doc) => {
            const ids = selected[docKey(doc)] ?? new Set<string>()
            const replaceable = doc.matches.filter((match) => match.replaceable)
            return (
              <article className={`${baseClass}__doc`} key={docKey(doc)}>
                <header className={`${baseClass}__doc-header`}>
                  <label>
                    <input
                      checked={replaceable.length > 0 && ids.size === replaceable.length}
                      disabled={!replaceable.length}
                      onChange={(e) => setDocSelected(doc, e.target.checked)}
                      type="checkbox"
                    />
                    <strong>{doc.title || t('untitled')}</strong>
                  </label>
                  <span className={`${baseClass}__pill`}>{collectionLabel[doc.collection] ?? doc.collection}</span>
                  <a href={editURL(doc)} rel="noopener noreferrer" target="_blank">
                    {t('edit')}
                  </a>
                </header>
                <ul className={`${baseClass}__matches`}>
                  {doc.matches.map((match) => (
                    <li
                      className={match.replaceable ? undefined : `${baseClass}__match--manual`}
                      key={match.id}
                    >
                      <label>
                        <input
                          checked={ids.has(match.id)}
                          disabled={!match.replaceable}
                          onChange={() => toggleMatch(doc, match.id)}
                          type="checkbox"
                        />
                        <code className={`${baseClass}__path`}>{match.fieldPath}</code>
                        <span className={`${baseClass}__snippet`}>
                          {match.before}
                          <del>{match.text}</del>
                          {match.replaceable && <ins>{match.replacement}</ins>}
                          {match.after}
                        </span>
                      </label>
                      {!match.replaceable && (
                        <span className={`${baseClass}__note`}>
                          {t(match.reason === 'partialCharacter' ? 'manualPartialCharacter' : 'manualCrossesNodes')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            )
          })}
        </section>
      )}

      <ConfirmationModal
        body={t('applyConfirm', {
          documents: pending?.documents.length ?? 0,
          matches: pending?.documents.reduce((sum, doc) => sum + doc.matchIds.length, 0) ?? 0,
        })}
        heading={t('apply')}
        modalSlug={confirmModalSlug}
        onCancel={() => setPending(undefined)}
        onConfirm={onApply}
      />
    </div>
  )
}
