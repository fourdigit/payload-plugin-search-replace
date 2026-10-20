import type { Config } from 'payload'

import type { SanitizedSearchPluginConfig } from '../types.js'
import type { SearchReplaceViewServerProps } from './SearchReplaceView/types.js'

import { translations } from '../translations.js'

export const ADMIN_VIEW_PATH = '/search-replace'

/**
 * The browser tab title, in the admin's fallback language: Payload takes a fixed string here,
 * not one per request language.
 */
const viewTitle = (config: Config): string => {
  const language = config.i18n?.fallbackLanguage ?? 'en'
  const all = (config.i18n?.translations ?? {}) as Record<
    string,
    { 'plugin-search-replace'?: { title?: string } } | undefined
  >
  return (
    all[language]?.['plugin-search-replace']?.title ??
    translations[language as keyof typeof translations]?.['plugin-search-replace'].title ??
    translations.en['plugin-search-replace'].title
  )
}

/** Registers the search & replace view and its nav link. */
export const withAdminView = (config: Config, pluginConfig: SanitizedSearchPluginConfig): Config => {
  const serverProps: SearchReplaceViewServerProps = {
    pluginOptions: {
      access: pluginConfig.replace?.access,
      canUseRegex: pluginConfig.replace?.canUseRegex,
      collections: pluginConfig.collections ?? [],
      maxApplyDocs: pluginConfig.replace?.maxApplyDocs,
    },
  }

  return {
    ...config,
    admin: {
      ...config.admin,
      components: {
        ...config.admin?.components,
        afterNavLinks: [
          ...(config.admin?.components?.afterNavLinks ?? []),
          '@fourdigit/payload-plugin-search-replace/client#SearchReplaceNavLink',
        ],
        views: {
          ...config.admin?.components?.views,
          searchReplace: {
            Component: {
              path: '@fourdigit/payload-plugin-search-replace/rsc#SearchReplaceView',
              serverProps,
            },
            meta: {
              title: viewTitle(config),
            },
            path: ADMIN_VIEW_PATH,
          },
        },
      },
    },
  }
}
