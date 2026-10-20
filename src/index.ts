import type { CollectionAfterChangeHook, Config } from 'payload'

import type { SanitizedSearchPluginConfig, SearchPluginConfig } from './types.js'

import { createSearchReplaceEndpoints } from './endpoints/searchReplace.js'
import { deleteFromSearch } from './Search/hooks/deleteFromSearch.js'
import { syncWithSearch } from './Search/hooks/syncWithSearch.js'
import { generateSearchCollection } from './Search/index.js'
import { translations } from './translations.js'
import { withAdminView } from './ui/withAdminView.js'

type CollectionAfterChangeHookArgs = Parameters<CollectionAfterChangeHook>[0]

type Translations = NonNullable<NonNullable<Config['i18n']>['translations']>

type Strings = Record<string, Record<string, string>>

/**
 * Adds the plugin's strings for every supported language: its own for en/ja, English for the
 * rest. The host's translations win, so it can override or translate the plugin's namespace.
 */
const mergeTranslations = (config: Config, own: Record<string, Strings>): Translations => {
  const existing = (config.i18n?.translations ?? {}) as Record<string, Strings | undefined>
  const languages = new Set([
    ...Object.keys(config.i18n?.supportedLanguages ?? {}),
    ...Object.keys(existing),
    ...Object.keys(own),
  ])
  const merged: Record<string, Strings> = {}
  for (const language of languages) {
    const ours = own[language] ?? own.en
    const theirs = existing[language] ?? {}
    merged[language] = { ...ours, ...theirs }
    for (const namespace of Object.keys(ours)) {
      merged[language][namespace] = { ...ours[namespace], ...theirs[namespace] }
    }
  }
  return merged as Translations
}

export const searchReplacePlugin =
  <ConfigTypes = unknown>(incomingPluginConfig: SearchPluginConfig<ConfigTypes>) =>
  (config: Config): Config => {
    const { collections } = config

    // If the user defines `localize` to either true or false, use that
    // Otherwise, set it based on if their config has localization enabled or disabled
    const shouldLocalize =
      typeof incomingPluginConfig.localize === 'boolean'
        ? incomingPluginConfig.localize
        : Boolean(config.localization)
    incomingPluginConfig.localize = shouldLocalize

    if (collections) {
      const labels = Object.fromEntries(
        collections
          .filter(({ slug }) => incomingPluginConfig.collections?.includes(slug))
          .map((collection) => [collection.slug, collection.labels]),
      )

      const pluginConfig: SanitizedSearchPluginConfig<ConfigTypes> = {
        // write any config defaults here
        deleteDrafts: false,
        labels,
        localizeContent: Boolean(config.localization),
        reindexBatchSize: incomingPluginConfig?.reindexBatchSize || 50,
        syncDrafts: true,
        ...incomingPluginConfig,
      }

      // add afterChange and afterDelete hooks to every search-enabled collection
      const collectionsWithSearchHooks = config?.collections
        ?.map((collection) => {
          const { hooks: existingHooks } = collection

          const enabledCollections = pluginConfig.collections || []
          const isEnabled = enabledCollections.indexOf(collection.slug) > -1
          if (isEnabled) {
            return {
              ...collection,
              hooks: {
                ...collection.hooks,
                afterChange: [
                  ...(existingHooks?.afterChange || []),
                  async (args: CollectionAfterChangeHookArgs) => {
                    await syncWithSearch({
                      ...args,
                      collection: collection.slug,
                      pluginConfig,
                    })
                  },
                ],
                beforeDelete: [
                  ...(existingHooks?.beforeDelete || []),
                  deleteFromSearch(pluginConfig),
                ],
              },
            }
          }

          return collection
        })
        .filter(Boolean)

      const nextConfig: Config = {
        ...config,
        collections: [
          ...(collectionsWithSearchHooks || []),
          generateSearchCollection(pluginConfig),
        ],
        endpoints: [...(config.endpoints || []), ...createSearchReplaceEndpoints(pluginConfig)],
        i18n: {
          ...config.i18n,
          translations: mergeTranslations(config, translations),
        },
      }

      return pluginConfig.replace?.disableAdminView ? nextConfig : withAdminView(nextConfig, pluginConfig)
    }

    return config
  }

/** The default `fields.exclude`; spread it to add patterns without losing the defaults. */
export { DEFAULT_EXCLUDE } from './core/textFields.js'
export type {
  ApplyRequest,
  ApplyResponse,
  ApplyResult,
  CapabilitiesResponse,
  PreviewDocument,
  PreviewResponse,
  SearchReplaceQuery,
} from './endpoints/searchReplace.js'
export type { FieldFilter, ReplaceConfig, SearchPluginConfig } from './types.js'
