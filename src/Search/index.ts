import type { CollectionConfig, Field } from 'payload'

import type { SanitizedSearchPluginConfig } from '../types.js'
import type { ReindexButtonServerProps } from './ui/ReindexButton/types.js'

import { generateReindexHandler } from '../utilities/generateReindexHandler.js'

// all settings can be overridden by the config
export const generateSearchCollection = (
  pluginConfig: SanitizedSearchPluginConfig,
): CollectionConfig => {
  const searchSlug = pluginConfig?.searchOverrides?.slug || 'search'
  const searchCollections = pluginConfig?.collections || []
  const collectionLabels = pluginConfig?.labels

  const defaultFields: Field[] = [
    {
      name: 'title',
      type: 'text',
      admin: {
        readOnly: true,
      },
      localized: pluginConfig.localize,
    },
    ...(
      [
        ['content', 'normalized with NFKC and case-folded'],
        ['contentRaw', 'case-folded'],
      ] as const
    ).map(
      ([name, form]): Field => ({
        name,
        type: 'textarea',
        access: {
          // Holds draft text of every indexed document; never expose it through the API,
          // even when the host opens up `read` on the collection for site search.
          read: () => false,
        },
        admin: {
          description: `Text of the indexed fields, ${form}. Used to find candidates for search & replace.`,
          hidden: true,
        },
        localized: pluginConfig.localizeContent,
        // The default 40,000 character limit would make long documents fail to index.
        maxLength: Number.MAX_SAFE_INTEGER,
      }),
    ),
    {
      name: 'priority',
      type: 'number',
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'doc',
      type: 'relationship',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
      index: true,
      maxDepth: 0,
      relationTo: searchCollections,
      required: true,
    },
    {
      name: 'docUrl',
      type: 'ui',
      admin: {
        components: {
          Field: {
            path: '@fourdigit/payload-plugin-search-replace/client#LinkToDoc',
          },
        },
        position: 'sidebar',
      },
    },
  ]

  if (!collectionLabels) {
    throw new Error('collectionLabels is required')
  }

  const newConfig: CollectionConfig = {
    ...(pluginConfig?.searchOverrides || {}),
    slug: searchSlug,
    access: {
      // The index lists documents across tenants and departments, including drafts, so nobody
      // reads or changes it through the API unless the host opts in (upstream: public read).
      // Syncing and search & replace use the Local API with access overridden.
      create: (): boolean => false,
      delete: (): boolean => false,
      read: (): boolean => false,
      update: (): boolean => false,
      ...(pluginConfig?.searchOverrides?.access || {}),
    },
    admin: {
      components: {
        views: {
          list: {
            actions: [
              {
                path: '@fourdigit/payload-plugin-search-replace/client#ReindexButton',
                serverProps: {
                  collectionLabels,
                  searchCollections,
                  searchSlug,
                } satisfies ReindexButtonServerProps,
              },
            ],
          },
        },
      },
      defaultColumns: ['title'],
      description:
        'This is a collection of automatically created search results. These results are used by the global site search and will be updated automatically as documents in the CMS are created or updated.',
      enableRichTextRelationship: false,
      useAsTitle: 'title',
      ...(pluginConfig?.searchOverrides?.admin || {}),
    },
    endpoints: [
      ...(pluginConfig?.searchOverrides?.endpoints || []),
      {
        handler: generateReindexHandler(pluginConfig),
        method: 'post',
        path: '/reindex',
      },
    ],
    fields:
      pluginConfig?.searchOverrides?.fields &&
      typeof pluginConfig?.searchOverrides?.fields === 'function'
        ? pluginConfig?.searchOverrides.fields({ defaultFields })
        : defaultFields,
    labels: {
      ...(pluginConfig?.searchOverrides?.labels || {
        plural: 'Search Results',
        singular: 'Search Result',
      }),
    },
  }

  return newConfig
}
