import type {
  CollectionAfterChangeHook,
  CollectionBeforeDeleteHook,
  CollectionConfig,
  Field,
  Locale,
  Payload,
  PayloadRequest,
  StaticLabel,
} from 'payload'

export type DocToSync = {
  [key: string]: any
  doc: {
    relationTo: string
    value: string
  }
  title: string
}

export type BeforeSync = (args: {
  collectionSlug: string
  originalDoc: {
    [key: string]: any
  }
  payload: Payload
  req: PayloadRequest
  searchDoc: DocToSync
}) => DocToSync | Promise<DocToSync>

export type FieldsOverride = (args: { defaultFields: Field[] }) => Field[]

export type SkipSyncFunction<ConfigTypes = unknown> = (args: {
  collectionSlug: string
  doc: any
  locale: ConfigTypes extends { locale: unknown } ? ConfigTypes['locale'] : string | undefined
  req: PayloadRequest
}) => boolean | Promise<boolean>

export type SearchPluginConfig<ConfigTypes = unknown> = {
  /**
   * @deprecated
   * This plugin gets the api route from the config directly and does not need to be passed in.
   * As long as you have `routes.api` set in your Payload config, the plugin will use that.
   * This property will be removed in the next major version.
   */
  apiBasePath?: string
  beforeSync?: BeforeSync
  collections?: string[]
  defaultPriorities?: {
    [collection: string]: ((doc: any) => number | Promise<number>) | number
  }
  /**
   * Controls whether drafts are deleted from the search index
   *
   * @default false (upstream: true) — replace works on drafts, so the index keeps them
   */
  deleteDrafts?: boolean
  /** Which fields are indexed and replaceable. */
  fields?: FieldFilter
  localize?: boolean
  /**
   * We use batching when re-indexing large collections. You can control the amount of items per batch, lower numbers should help with memory.
   *
   * @default 50
   */
  reindexBatchSize?: number
  /** Options for the search & replace endpoints and admin view. */
  replace?: ReplaceConfig
  searchOverrides?: { fields?: FieldsOverride } & Partial<Omit<CollectionConfig, 'fields'>>
  /**
   * Determine whether to skip syncing a document for a specific locale.
   * Useful for multi-tenant applications, conditional indexing, or any scenario where
   * sync behavior should vary by locale, document, or other factors.
   *
   * @default undefined - All configured locales will be synced
   *
   * @example
   * // Skip syncing based on document's tenant settings
   * skipSync: async ({ locale, req, doc, collectionSlug }) => {
   *   // For non-localized collections, locale will be undefined
   *   if (!locale) return false
   *
   *   const tenant = await req.payload.findByID({
   *     collection: 'tenants',
   *     id: doc.tenant.id
   *   })
   *   return !tenant.allowedLocales.includes(locale)
   * }
   */
  skipSync?: SkipSyncFunction<ConfigTypes>
  /**
   * Controls whether drafts are synced to the search index
   *
   * @default true (upstream: false) — replace works on drafts, so the index has to include them
   */
  syncDrafts?: boolean
}

/**
 * Chooses which text, textarea and richText fields are indexed and can be replaced.
 * `schemaPath` is the dot path of field names without array indices, e.g. `layout.content`.
 */
export type FieldFilter = {
  /**
   * Glob patterns on `schemaPath` to leave out. `*` matches one segment, `**` any number.
   * Replaces the defaults; spread `DEFAULT_EXCLUDE` to keep them. Fields hidden from the admin
   * panel are left out either way unless `include` returns `true` for them.
   *
   * @default DEFAULT_EXCLUDE — slugs, URLs, nested-docs `breadcrumbs`, stripe `stripeID`
   */
  exclude?: string[]
  /** Decides per field, hidden fields included. Returning `undefined` falls back to the defaults and `exclude`. */
  include?: (args: { collection: string; field: Field; schemaPath: string }) => boolean | undefined
}

export type ReplaceAccessArgs = { req: PayloadRequest }

export type ReplaceConfig = {
  /**
   * Who can open the search & replace view and call its endpoints.
   * Document-level access (tenants, departments…) still applies to every read and write.
   *
   * @default signed-in users of `admin.user` who pass its `access.admin`
   */
  access?: (args: ReplaceAccessArgs) => boolean | Promise<boolean>
  /**
   * Who can search with regular expressions.
   *
   * @default () => false
   */
  canUseRegex?: (args: ReplaceAccessArgs) => boolean | Promise<boolean>
  /**
   * Hide the admin view and its nav link. The endpoints stay available.
   *
   * @default false
   */
  disableAdminView?: boolean
  /**
   * Largest number of documents one apply request may change. Unset means no limit.
   */
  maxApplyDocs?: number
}

export type CollectionLabels = {
  [collection: string]: CollectionConfig['labels']
}

export type ResolvedCollectionLabels = {
  [collection: string]: StaticLabel
}

export type SearchPluginConfigWithLocales<ConfigTypes = unknown> = {
  labels?: CollectionLabels
} & SearchPluginConfig<ConfigTypes>

export type SanitizedSearchPluginConfig<ConfigTypes = unknown> = {
  /**
   * The index text fields are localized whenever the host has localization, even with
   * `localize: false` (which then only affects `title`): one shared value would hold the text of
   * whichever locale was synced last.
   */
  localizeContent: boolean
  reindexBatchSize: number
  syncDrafts: boolean
} & SearchPluginConfigWithLocales<ConfigTypes>

export type SyncWithSearchArgs = {
  collection: string
  pluginConfig: SanitizedSearchPluginConfig
} & Omit<Parameters<CollectionAfterChangeHook>[0], 'collection'>

export type SyncDocArgs = {
  locale?: Locale['code']
  onSyncError?: () => void
} & Omit<SyncWithSearchArgs, 'context' | 'previousDoc'>

// Extend the `CollectionAfterChangeHook` with more function args
// Convert the `collection` arg from `SanitizedCollectionConfig` to a string
export type SyncWithSearch = (Args: SyncWithSearchArgs) => ReturnType<CollectionAfterChangeHook>

export type DeleteFromSearch = (args: SearchPluginConfig) => CollectionBeforeDeleteHook
