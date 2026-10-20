import type { SyncWithSearch } from '../../types.js'

import { syncDocAsSearchIndex } from '../../utilities/syncDocAsSearchIndex.js'

/**
 * Upstream syncs only the request locale. The index here holds non-localized fields too, so a
 * change saved in one locale can change the text of every locale: sync them all, starting with
 * the request locale.
 */
export const syncWithSearch: SyncWithSearch = async (args) => {
  const localization = args.req.payload.config.localization
  if (!localization) {
    return syncDocAsSearchIndex(args)
  }

  const current =
    args.req.locale && args.req.locale !== 'all' ? args.req.locale : localization.defaultLocale
  const locales = [current, ...localization.localeCodes.filter((code) => code !== current)]

  // Local API calls with this `req` set `req.locale` / `req.fallbackLocale`; restore them so
  // hooks that run after this one still see the locale the document was saved in.
  const { fallbackLocale, locale: requestLocale } = args.req
  try {
    for (const [index, locale] of locales.entries()) {
      await syncDocAsSearchIndex({
        ...args,
        locale,
        operation: index === 0 ? args.operation : 'update',
      })
    }
  } finally {
    args.req.locale = requestLocale
    args.req.fallbackLocale = fallbackLocale
  }

  return args.doc
}
