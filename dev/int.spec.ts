import type { ApplyResponse, PreviewResponse } from '@fourdigit/payload-plugin-search-replace'
import type { Payload, PayloadRequest, TypedUser } from 'payload'

import config from '@payload-config'
import { createLocalReq, getLocalI18n, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { devUser, otherUser } from './helpers/credentials.js'

let payload: Payload
let user: TypedUser
let other: TypedUser

const text = (value: string, format = 0) => ({ type: 'text', format, text: value, version: 1 })
const richText = (...paragraphs: object[][]) => ({
  root: {
    type: 'root',
    children: paragraphs.map((children) => ({ type: 'paragraph', children, version: 1 })),
    version: 1,
  },
})

const callEndpoint = async <T>(
  path: string,
  body?: unknown,
  { anonymous = false, as, language }: { anonymous?: boolean; as?: TypedUser; language?: 'en' | 'ja' } = {},
): Promise<{ body: T; status: number }> => {
  const endpoint = payload.config.endpoints.find((candidate) => candidate.path === path)
  if (!endpoint) {
    throw new Error(`No endpoint ${path}`)
  }
  const i18n = language ? await getLocalI18n({ config: payload.config, language }) : undefined
  const req = await createLocalReq({ req: i18n ? { i18n } : undefined, user: anonymous ? undefined : (as ?? user) }, payload)
  req.json = () => Promise.resolve(body)
  const response = await endpoint.handler(req)
  return { body: (await response.json()) as T, status: response.status }
}

const preview = (body: object, as?: TypedUser) =>
  callEndpoint<PreviewResponse>('/search-replace/preview', { mode: 'text', ...body }, { as })
const apply = (body: object, as?: TypedUser) =>
  callEndpoint<ApplyResponse>('/search-replace/apply', { mode: 'text', ...body }, { as })

const findDoc = (response: { body: PreviewResponse }, id: number | string) =>
  response.body.documents.find((candidate) => candidate.id === id)

const applyAll = async (id: number | string, query: Record<string, unknown>, collection = 'posts') => {
  const found = await preview(query)
  const doc = findDoc(found, id)
  if (!doc) {
    throw new Error(`No preview result for ${collection} ${id}`)
  }
  return apply({
    ...query,
    documents: [
      {
        id,
        collection,
        matchIds: doc.matches.filter((match) => match.replaceable).map((match) => match.id),
        updatedAt: doc.updatedAt,
      },
    ],
  })
}

const latestDraft = (id: number | string, locale = 'ja') =>
  payload.findByID({ id, collection: 'posts', draft: true, fallbackLocale: false as never, locale: locale as never })

const createPost = (data: Record<string, unknown>) =>
  payload.create({ collection: 'posts', data: { _status: 'published', ...data }, locale: 'ja' })

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
  const findUser = async (email: string) => {
    const { docs } = await payload.find({ collection: 'users', where: { email: { equals: email } } })
    return { ...docs[0], collection: 'users' } as TypedUser
  }
  user = await findUser(devUser.email)
  other = await findUser(otherUser.email)
})

describe('search index', () => {
  test('stores normalized text of every indexed field and leaves out slug', async () => {
    const post = await createPost({
      slug: 'secret-slug',
      content: richText([text('本文の'), text('ＴＥＸＴ', 1)]),
      layout: [{ blockType: 'callout', body: 'コールアウト' }],
      meta: { description: 'メタ説明' },
      sections: [{ heading: '見出し', tags: ['タグA'] }],
      title: 'Index Title',
    })

    const { docs } = await payload.find({
      collection: 'search',
      locale: 'ja',
      where: { 'doc.value': { equals: post.id } },
    })

    expect(docs).toHaveLength(1)
    expect(docs[0]?.title).toBe('Index Title')
    const content = docs[0]?.content as string
    for (const expected of ['index title', '本文のtext', 'コールアウト', 'メタ説明', '見出し', 'タグa']) {
      expect(content).toContain(expected)
    }
    expect(content).not.toContain('secret-slug')
  })
})

describe('preview', () => {
  test('finds matches in every field type and flags matches across rich text nodes', async () => {
    const post = await createPost({
      content: richText([text('プランAとプラン'), text('A', 1)]),
      sections: [{ heading: 'プランAの説明', tags: ['プランA'] }],
      title: 'プランA案内',
    })

    const { body, status } = await preview({ find: 'プランA' })
    expect(status).toBe(200)

    const doc = body.documents.find((candidate) => candidate.id === post.id)
    expect(doc?.title).toBe('プランA案内')
    expect(doc?.matches.map((match) => [match.fieldPath, match.replaceable])).toEqual([
      ['title', true],
      ['content', true],
      ['content', false],
      ['sections.0.heading', true],
      ['sections.0.tags.0', true],
    ])
  })

  test('matches full-width text only with normalizeWidth', async () => {
    const post = await createPost({ title: 'ＡＢＣＤポイント' })

    const plain = await preview({ find: 'ABCD' })
    expect(plain.body.documents.some((doc) => doc.id === post.id)).toBe(false)

    const normalized = await preview({ find: 'ABCD', normalizeWidth: true })
    const match = normalized.body.documents.find((doc) => doc.id === post.id)?.matches[0]
    expect(match).toMatchObject({ after: 'ポイント', text: 'ＡＢＣＤ' })
  })

  test('looks only at the requested locale, without fallback', async () => {
    const post = await createPost({ title: '日本語だけのタイトル' })

    const en = await preview({ find: '日本語だけ', locale: 'en' })
    expect(en.body.documents.some((doc) => doc.id === post.id)).toBe(false)

    const ja = await preview({ find: '日本語だけ', locale: 'ja' })
    expect(ja.body.documents.some((doc) => doc.id === post.id)).toBe(true)
  })

  test('indexes each locale without fallback text', async () => {
    const post = await createPost({ title: '日本語だけの索引' })

    const indexed = async (locale: 'en' | 'ja') => {
      const { docs } = await payload.find({
        collection: 'search',
        fallbackLocale: false as never,
        locale,
        overrideAccess: true,
        where: { 'doc.value': { equals: post.id } },
      })
      return (docs[0] as { contentRaw?: string } | undefined)?.contentRaw ?? ''
    }

    expect(await indexed('ja')).toContain('日本語だけの索引')
    expect(await indexed('en')).not.toContain('日本語だけの索引')
  })

  test('rejects anonymous requests', async () => {
    const { status } = await callEndpoint('/search-replace/preview', { find: 'x' }, { anonymous: true })
    expect(status).toBe(401)
  })

  test('rejects regular expressions RE2 cannot run', async () => {
    const { status } = await preview({ find: '(a)\\1', mode: 'regex' })
    expect(status).toBe(400)
  })
})

describe('apply', () => {
  test('saves the replacement as a draft and keeps the published version', async () => {
    const post = await createPost({
      content: richText([text('旧名称の説明'), text('旧名称', 1)]),
      title: '旧名称のお知らせ',
    })

    const found = await preview({ find: '旧名称', replace: '新名称' })
    const doc = found.body.documents.find((candidate) => candidate.id === post.id)!
    expect(doc.matches).toHaveLength(3)

    const { body } = await apply({
      documents: [
        {
          id: post.id,
          collection: 'posts',
          matchIds: doc.matches.map((match) => match.id),
          updatedAt: doc.updatedAt,
        },
      ],
      find: '旧名称',
      replace: '新名称',
    })
    expect(body.results[0]).toMatchObject({ skippedIds: [], status: 'updated' })
    expect(body.results[0]?.appliedIds).toHaveLength(3)

    const published = await payload.findByID({ id: post.id, collection: 'posts', locale: 'ja' })
    expect(published.title).toBe('旧名称のお知らせ')

    const draft = await payload.findByID({ id: post.id, collection: 'posts', draft: true, locale: 'ja' })
    expect(draft.title).toBe('新名称のお知らせ')
    expect(JSON.stringify(draft.content)).toContain('新名称の説明')
    // The bold node was replaced in place and kept its format.
    const bold = (draft.content).root.children[0].children[1]
    expect(bold).toMatchObject({ format: 1, text: '新名称' })

    // The index follows the draft.
    const again = await preview({ find: '旧名称' })
    expect(again.body.documents.some((candidate) => candidate.id === post.id)).toBe(false)
  })

  test('applies only the selected matches', async () => {
    const post = await createPost({ title: '赤と赤と赤' })
    const found = await preview({ find: '赤', replace: '青' })
    const doc = found.body.documents.find((candidate) => candidate.id === post.id)!

    await apply({
      documents: [{ id: post.id, collection: 'posts', matchIds: [doc.matches[1].id], updatedAt: doc.updatedAt }],
      find: '赤',
      replace: '青',
    })

    const draft = await payload.findByID({ id: post.id, collection: 'posts', draft: true, locale: 'ja' })
    expect(draft.title).toBe('赤と青と赤')
  })

  test('skips a document that changed after the preview', async () => {
    const post = await createPost({ title: '変更検知テスト' })
    const found = await preview({ find: '変更検知', replace: 'X' })
    const doc = found.body.documents.find((candidate) => candidate.id === post.id)!

    await payload.update({
      id: post.id,
      collection: 'posts',
      data: { title: '変更検知テスト（編集済み）' },
      draft: true,
      locale: 'ja',
    })

    const { body } = await apply({
      documents: [
        { id: post.id, collection: 'posts', matchIds: doc.matches.map((match) => match.id), updatedAt: doc.updatedAt },
      ],
      find: '変更検知',
      replace: 'X',
    })
    expect(body.results[0]?.status).toBe('stale')
  })

  test('does not apply matches that cross rich text nodes', async () => {
    const post = await createPost({ content: richText([text('跨'), text('ぎ', 1)]) })
    const found = await preview({ find: '跨ぎ', replace: 'X' })
    const doc = found.body.documents.find((candidate) => candidate.id === post.id)!
    expect(doc.matches[0]?.replaceable).toBe(false)

    const { body } = await apply({
      documents: [{ id: post.id, collection: 'posts', matchIds: [doc.matches[0].id], updatedAt: doc.updatedAt }],
      find: '跨ぎ',
      replace: 'X',
    })
    expect(body.results[0]).toMatchObject({ status: 'unchanged' })
  })

  test('regex replacement with groups', async () => {
    const post = await createPost({ title: '価格 100円 / 2000円' })
    const query = { find: '(\\d+)円', mode: 'regex', replace: '¥$1' }
    const found = await preview(query)
    const doc = found.body.documents.find((candidate) => candidate.id === post.id)!

    await apply({
      ...query,
      documents: [
        { id: post.id, collection: 'posts', matchIds: doc.matches.map((match) => match.id), updatedAt: doc.updatedAt },
      ],
    })

    const draft = await payload.findByID({ id: post.id, collection: 'posts', draft: true, locale: 'ja' })
    expect(draft.title).toBe('価格 ¥100 / ¥2000')
  })
})

describe('index access and coverage', () => {
  test('the index is not readable through the API, and its text never is', async () => {
    await expect(
      payload.find({ collection: 'search', overrideAccess: false, user }),
    ).rejects.toThrow()
  })

  test('indexes documents longer than the default text limit', async () => {
    const chunk = 'あ'.repeat(20_000)
    const post = await createPost({
      layout: [chunk, chunk, `${chunk}末尾の目印`].map((body) => ({ blockType: 'callout', body })),
    })
    const found = await preview({ find: '末尾の目印' })
    expect(findDoc(found, post.id)).toBeDefined()
  })

  test('a non-localized field changed in one locale is found in the others', async () => {
    const post = await createPost({ sections: [{ heading: '共通の旧見出し' }] })
    await payload.update({
      id: post.id,
      collection: 'posts',
      data: { sections: [{ heading: '共通の新見出し' }] },
      locale: 'ja',
    })
    const en = await preview({ find: '共通の新見出し', locale: 'en' })
    expect(findDoc(en, post.id)).toBeDefined()
  })

  test('case-insensitive Greek text is found even where lower-casing differs (final sigma)', async () => {
    const post = await createPost({ title: 'ΟΔΟΣ ΑΘΗΝΩΝ' })
    const found = await preview({ find: 'οδοσ' })
    expect(findDoc(found, post.id)).toBeDefined()
  })

  test.each([
    ['ſtraße', 'strasse'.slice(0, 3)],
    ['ᲀасилий', 'васил'],
  ])('a body with %s is found by searching %s', async (body, find) => {
    const post = await createPost({ title: body })
    const found = await preview({ find })
    expect(findDoc(found, post.id)).toBeDefined()
  })

  test('syncing every locale leaves req.locale as it was', async () => {
    const post = await createPost({ title: 'ロケール復元' })
    const req = await createLocalReq({ locale: 'ja', user }, payload)
    const { fallbackLocale } = req
    await payload.update({ id: post.id, collection: 'posts', data: { title: 'ロケール復元2' }, locale: 'ja', req })
    expect(req.locale).toBe('ja')
    expect(req.fallbackLocale).toBe(fallbackLocale)
  })

  test('a search text with a backslash is found', async () => {
    const post = await createPost({ title: 'C:\\data\\file' })
    const found = await preview({ find: '\\data\\' })
    expect(findDoc(found, post.id)).toBeDefined()
  })
})

describe('apply across field types', () => {
  test('replaces in named tabs, blocks, arrays and hasMany text and keeps other locales', async () => {
    const post = await createPost({
      layout: [{ blockType: 'callout', body: '置換対象の本文' }],
      meta: { description: '置換対象の説明' },
      sections: [{ heading: '置換対象の見出し', tags: ['置換対象', 'そのまま'] }],
      title: '置換対象のタイトル',
    })
    await payload.update({
      id: post.id,
      collection: 'posts',
      data: { title: 'English title' },
      draft: true,
      locale: 'en',
    })

    const { body } = await applyAll(post.id, { find: '置換対象', replace: '置換済み' })
    expect(body.results[0]).toMatchObject({ skippedIds: [], status: 'updated' })
    expect(body.results[0]?.appliedIds).toHaveLength(5)

    const ja = await latestDraft(post.id)
    expect(ja.title).toBe('置換済みのタイトル')
    expect(ja.meta?.description).toBe('置換済みの説明')
    expect(ja.layout?.[0]).toMatchObject({ blockType: 'callout', body: '置換済みの本文' })
    expect(ja.sections?.[0]).toMatchObject({ heading: '置換済みの見出し', tags: ['置換済み', 'そのまま'] })

    const en = await latestDraft(post.id, 'en')
    expect(en.title).toBe('English title')
  })

  test('replaces full-width text with normalizeWidth, only in the matched range', async () => {
    const post = await createPost({ title: 'ｶﾞｲﾄﾞとＡＢＣＤ' })
    await applyAll(post.id, { find: 'ガイド', normalizeWidth: true, replace: '案内' })
    expect((await latestDraft(post.id)).title).toBe('案内とＡＢＣＤ')
  })

  test('leaves a match on part of an expanded character for manual fixing', async () => {
    const post = await createPost({ title: '㍻の記録' })
    const found = await preview({ find: '平', normalizeWidth: true })
    expect(findDoc(found, post.id)?.matches[0]).toMatchObject({
      reason: 'partialCharacter',
      replaceable: false,
    })
  })
})

describe('collections without drafts and access control', () => {
  test('updates directly and reports fields the user may not update as skipped', async () => {
    const note = await payload.create({
      collection: 'notes',
      data: { body: 'メモの旧語', locked: '旧語ロック', title: 'メモ' },
    })
    const found = await preview({ collections: ['notes'], find: '旧語' })
    const doc = findDoc(found, note.id)!
    expect(doc.matches.map((match) => match.fieldPath)).toEqual(['locked', 'body'])

    const { body } = await apply({
      collections: ['notes'],
      documents: [
        { id: note.id, collection: 'notes', matchIds: doc.matches.map((m) => m.id), updatedAt: doc.updatedAt },
      ],
      find: '旧語',
      replace: '新語',
    })
    const lockedId = doc.matches[0].id
    expect(body.results[0]).toMatchObject({ skippedIds: [lockedId], status: 'updated' })

    const saved = await payload.findByID({ id: note.id, collection: 'notes' })
    expect(saved).toMatchObject({ body: 'メモの新語', locked: '旧語ロック' })
  })

  test('another user sees no documents they cannot read and cannot change them', async () => {
    const note = await payload.create({ collection: 'notes', data: { body: '機密メモの本文' } })

    const found = await preview({ collections: ['notes'], find: '機密メモ' }, other)
    expect(found.status).toBe(200)
    expect(findDoc(found, note.id)).toBeUndefined()

    const { body } = await apply(
      {
        collections: ['notes'],
        documents: [{ id: note.id, collection: 'notes', matchIds: ['body~~0-4'] }],
        find: '機密メモ',
        replace: 'X',
      },
      other,
    )
    expect(body.results[0]?.status).toBe('error')
    expect((await payload.findByID({ id: note.id, collection: 'notes' })).body).toBe('機密メモの本文')
  })

  test('regular expressions need canUseRegex', async () => {
    const { status } = await preview({ find: 'a+', mode: 'regex' }, other)
    expect(status).toBe(403)
  })

  test('rejects more documents than maxApplyDocs', async () => {
    const documents = Array.from({ length: 51 }, (_, id) => ({ id: id + 1, collection: 'posts', matchIds: ['x'] }))
    const { status } = await apply({ documents, find: 'x' })
    expect(status).toBe(400)
  })

  test('rejects a malformed apply body', async () => {
    const { status } = await apply({ documents: 'nope', find: 'x' })
    expect(status).toBe(400)
  })
})

describe('admin language', () => {
  test('messages follow the request language', async () => {
    const regex = await callEndpoint<{ message: string }>(
      '/search-replace/preview',
      { find: 'a+', mode: 'regex' },
      { as: other, language: 'ja' },
    )
    expect(regex).toMatchObject({ body: { message: '正規表現で検索する権限がありません。' }, status: 403 })

    const invalid = await callEndpoint<{ message: string }>(
      '/search-replace/preview',
      { find: '(a', mode: 'regex' },
      { language: 'ja' },
    )
    expect(invalid.status).toBe(400)
    expect(invalid.body.message).toMatch(/^正規表現が正しくありません: /)

    const post = await createPost({ title: '言語の確認' })
    const found = await preview({ find: '言語の確認' })
    const doc = findDoc(found, post.id)!
    await payload.update({ id: post.id, collection: 'posts', data: { title: '言語の確認（更新）' }, locale: 'ja' })
    const stale = await callEndpoint<ApplyResponse>(
      '/search-replace/apply',
      {
        documents: [{ id: post.id, collection: 'posts', matchIds: doc.matches.map((m) => m.id), updatedAt: doc.updatedAt }],
        find: '言語の確認',
        mode: 'text',
        replace: 'X',
      },
      { language: 'ja' },
    )
    expect(stale.body.results[0]).toMatchObject({
      message: '検索後にドキュメントが変更されました。もう一度検索してください。',
      status: 'stale',
    })
  })

  test('matches carry the field label in the request language', async () => {
    const post = await createPost({ title: 'ラベルの確認' })
    const found = await callEndpoint<PreviewResponse>(
      '/search-replace/preview',
      { find: 'ラベルの確認', mode: 'text' },
      { language: 'en' },
    )
    expect(findDoc(found, post.id)?.matches[0]).toMatchObject({ fieldLabel: 'Title', fieldPath: 'title' })
  })
})
