// Captures the README screenshots from the dev app.
//
//   DATABASE_URL=file:/tmp/readme.db pnpm dev   # a fresh database, so the seed runs
//   node dev/screenshots.mjs                    # writes docs/images/*.png
//
// BASE_URL defaults to http://localhost:3000. CHROME_CHANNEL=chrome uses the installed Chrome
// instead of Playwright's bundled browser.
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const baseURL = process.env.BASE_URL || 'http://localhost:3000'
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/images')
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || undefined })
const context = await browser.newContext({
  baseURL,
  deviceScaleFactor: 2,
  locale: 'en-US',
  viewport: { height: 900, width: 1280 },
})
const page = await context.newPage()
// Leave Next.js's dev-mode badge out of the pictures.
await context.addInitScript(() => {
  const style = document.createElement('style')
  style.textContent = 'nextjs-portal { display: none !important; }'
  document.addEventListener('DOMContentLoaded', () => document.head.append(style))
})

const shot = async (name, { height } = {}) => {
  await page.waitForTimeout(300)
  await page.screenshot({
    clip: height ? { height, width: 1280, x: 0, y: 0 } : undefined,
    path: path.join(outDir, `${name}.png`),
  })
  console.log(`docs/images/${name}.png`)
}

await page.goto('/admin/login')
await page.getByLabel('Email').fill('dev@payloadcms.com')
await page.getByLabel('Password').fill('test')
await page.getByRole('button', { name: 'Login' }).click()
await page.waitForURL('**/admin')

// 1. The form, with the nav link.
await page.goto('/admin/search-replace')
const view = page.locator('.search-replace')
await view.waitFor()
await page.locator('.search-replace__form input[type="text"]').nth(0).fill('さくらポイント')
await page.locator('.search-replace__form input[type="text"]').nth(1).fill('はなポイント')
await shot('01-form', { height: 480 })

// 2. Preview: every match with its context, including one that crosses formatting.
await page.locator('.search-replace__form button[type="submit"]').click()
await page.locator('.search-replace__results').waitFor()
await shot('02-preview')

// 3. Confirmation before saving.
await page.locator('.search-replace__toolbar-actions button').last().click()
const modal = page.locator('.confirmation-modal')
await modal.waitFor()
await shot('03-confirm')

// 4. Result: saved as drafts.
await modal.getByRole('button').last().click()
await page.locator('.toast-success, .toast-info, [data-sonner-toast]').first().waitFor()
await shot('04-result')

// 5. Width-insensitive matching.
await page.goto('/admin/search-replace')
await view.waitFor()
await page.locator('.search-replace__form input[type="text"]').nth(0).fill('ABCD')
await page.locator('.search-replace__form input[type="text"]').nth(1).fill('EFGH')
await page.getByLabel(/width/i).check()
await page.locator('.search-replace__form button[type="submit"]').click()
await page.locator('.search-replace__results').waitFor()
await shot('06-normalize-width')

// 6. The saved draft: the published version is unchanged until it is published.
const { docs } = await (await page.request.get('/api/posts?where[slug][equals]=sakura-point&depth=0')).json()
await page.goto(`/admin/collections/posts/${docs[0].id}/versions`)
await page.locator('.versions, table').first().waitFor()
await shot('05-versions', { height: 360 })

await browser.close()
