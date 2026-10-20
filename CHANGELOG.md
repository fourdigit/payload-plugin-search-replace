# Changelog

## 0.1.0 (unreleased)

First release, forked from `@payloadcms/plugin-search` 3.90.0.

### Changes from `@payloadcms/plugin-search`

- The `search` collection indexes the text of every `text`, `textarea`, `hasMany` text and Lexical `richText` field (in groups, tabs, arrays and blocks) as `content` (NFKC, case-folded) and `contentRaw` (case-folded)
- New `fields.include` / `fields.exclude` options choose the indexed fields. By default, fields hidden from the admin panel and the fields in the exported `DEFAULT_EXCLUDE` (slugs, URLs, nested-docs `breadcrumbs`, stripe `stripeID`) are left out
- Defaults: `syncDrafts: true`, `deleteDrafts: false`
- The `search` collection is not readable, updatable or deletable through the API by default, and its text fields never are readable
- Every locale is synced when a document changes, since non-localized fields are indexed too
- `title` falls back to the collection's `useAsTitle` field

### Added

- `POST /api/search-replace/preview`, `POST /api/search-replace/apply`, `GET /api/search-replace/capabilities`
- Admin view at `/admin/search-replace` with a nav link (English, Japanese)
- `replace.access`, `replace.canUseRegex`, `replace.maxApplyDocs`, `replace.disableAdminView` options
