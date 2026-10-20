import type { AdminViewServerProps } from 'payload'

import { DefaultTemplate } from '@payloadcms/next/templates'
import { getTranslation } from '@payloadcms/translations'
import { Gutter } from '@payloadcms/ui'
import { notFound, redirect } from 'next/navigation.js'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

import type { SearchReplaceViewServerProps } from './types.js'

import { defaultReplaceAccess } from '../../defaultAccess.js'
import { SearchReplaceClient } from './index.client.js'

export const SearchReplaceView: React.FC<AdminViewServerProps & SearchReplaceViewServerProps> = async ({
  initPageResult,
  params,
  pluginOptions,
  searchParams,
}) => {
  const { req } = initPageResult
  const { i18n, payload, user } = req

  if (!user) {
    const adminRoute = payload.config.routes.admin
    const loginRoute = payload.config.admin.routes?.login ?? '/login'
    redirect(
      `${formatAdminURL({ adminRoute, path: loginRoute })}?redirect=${encodeURIComponent(
        formatAdminURL({ adminRoute, path: '/search-replace' }),
      )}`,
    )
  }
  const access = pluginOptions.access ?? defaultReplaceAccess
  if (!(await access({ req }))) {
    notFound()
  }

  const collections = pluginOptions.collections
    .filter((slug) => initPageResult.visibleEntities.collections.includes(slug))
    .map((slug) => {
      const labels = payload.collections[slug]?.config.labels
      return { slug, label: labels?.plural ? getTranslation(labels.plural, i18n) : slug }
    })

  const localization = payload.config.localization
  const locales = localization
    ? localization.locales.map((locale) => ({
        code: locale.code,
        label: typeof locale.label === 'string' ? locale.label : getTranslation(locale.label, i18n),
      }))
    : []

  return (
    <DefaultTemplate
      i18n={i18n}
      locale={initPageResult.locale}
      params={params}
      payload={payload}
      permissions={initPageResult.permissions}
      req={req}
      searchParams={searchParams}
      user={user}
      visibleEntities={initPageResult.visibleEntities}
    >
      <Gutter>
        <SearchReplaceClient
          canUseRegex={Boolean(await pluginOptions.canUseRegex?.({ req }))}
          collections={collections}
          defaultLocale={initPageResult.locale?.code ?? (localization ? localization.defaultLocale : undefined)}
          locales={locales}
          maxApplyDocs={pluginOptions.maxApplyDocs}
        />
      </Gutter>
    </DefaultTemplate>
  )
}
