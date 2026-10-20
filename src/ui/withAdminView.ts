import type { Config } from 'payload'

import type { SanitizedSearchPluginConfig } from '../types.js'
import type { SearchReplaceViewServerProps } from './SearchReplaceView/types.js'

export const ADMIN_VIEW_PATH = '/search-replace'

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
              title: 'Search & Replace',
            },
            path: ADMIN_VIEW_PATH,
          },
        },
      },
    },
  }
}
