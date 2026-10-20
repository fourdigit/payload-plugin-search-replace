'use client'

import { Link, useConfig, useTranslation } from '@payloadcms/ui'
import { usePathname } from 'next/navigation.js'
import { formatAdminURL } from 'payload/shared'
import React, { useEffect, useState } from 'react'

/** Shown only to users the plugin's `replace.access` lets in. */
export const SearchReplaceNavLink: React.FC = () => {
  const { config } = useConfig()
  const { t } = useTranslation()
  const pathname = usePathname()
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    let active = true
    fetch(formatAdminURL({ apiRoute: config.routes.api, path: '/search-replace/capabilities' }), {
      credentials: 'include',
    })
      .then((res) => active && setAllowed(res.ok))
      .catch(() => active && setAllowed(false))
    return () => {
      active = false
    }
  }, [config.routes.api])

  if (!allowed) {
    return null
  }

  const href = formatAdminURL({ adminRoute: config.routes.admin, path: '/search-replace' })
  const current = pathname === href

  return (
    <Link className={`nav__link${current ? ' active' : ''}`} href={href} prefetch={false}>
      {current && <div className="nav__link-indicator" />}
      <span className="nav__link-label">
        {(t as (key: string) => string)('plugin-search-replace:navLabel')}
      </span>
    </Link>
  )
}
