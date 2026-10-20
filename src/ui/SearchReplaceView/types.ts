import type { ReplaceConfig } from '../../types.js'

/** Passed from the plugin to the view through `serverProps`. Functions stay on the server. */
export type SearchReplaceViewServerProps = {
  pluginOptions: {
    collections: string[]
  } & Pick<ReplaceConfig, 'access' | 'canUseRegex' | 'maxApplyDocs'>
}

export type SearchReplaceClientProps = {
  canUseRegex: boolean
  collections: { label: string; slug: string }[]
  defaultLocale?: string
  locales: { code: string; label: string }[]
  maxApplyDocs?: number
}
