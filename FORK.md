# Fork notes

This package started as a fork of [`@payloadcms/plugin-search`](https://github.com/payloadcms/payload/tree/v3.90.0/packages/plugin-search) (MIT).

| | |
|---|---|
| Upstream | `payloadcms/payload` — `packages/plugin-search` |
| Base version | `v3.90.0` (identical to 3.86.0 in published output) |
| Fork commit | the commit titled `chore: fork @payloadcms/plugin-search v3.90.0` |

## Changes from upstream at fork time

- Admin component paths `@payloadcms/plugin-search/client#…` → `@fourdigit/payload-plugin-search-replace/client#…`
- Everything else under `src/` was copied verbatim.

Later changes are listed in `CHANGELOG.md`. To pick up upstream fixes, diff upstream
`packages/plugin-search/src` between the base version and the new tag, and apply the
relevant hunks here.
