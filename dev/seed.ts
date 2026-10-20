import type { Payload } from 'payload'

import { devUser, otherUser } from './helpers/credentials.js'

export const seed = async (payload: Payload) => {
  for (const user of [devUser, otherUser]) {
    const { totalDocs } = await payload.count({
      collection: 'users',
      where: { email: { equals: user.email } },
    })
    if (!totalDocs) {
      await payload.create({ collection: 'users', data: user })
    }
  }

  if (process.env.NODE_ENV === 'test' || (await payload.count({ collection: 'posts' })).totalDocs) {
    return
  }

  const text = (value: string, format = 0) => ({ type: 'text', format, text: value, version: 1 })
  const paragraph = (...children: object[]) => ({ type: 'paragraph', children, version: 1 })
  const richText = (...children: object[]) => ({
    root: { type: 'root', children, direction: null, format: '', indent: 0, version: 1 },
  })

  await payload.create({
    collection: 'posts',
    data: {
      slug: 'sakura-point',
      _status: 'published',
      content: richText(
        paragraph(text('さくらポイントは、毎月のお支払いで貯まります。')),
        paragraph(text('さくら'), text('ポイント', 1), text('の有効期限は2年です。')),
      ),
      meta: { description: 'さくらポイントの貯め方と使い方' },
      sections: [{ heading: 'さくらポイントとは', tags: ['さくらポイント', 'ポイント'] }],
      title: 'さくらポイントのご案内',
    },
    locale: 'ja',
  })
  await payload.create({
    collection: 'posts',
    data: {
      _status: 'published',
      content: richText(paragraph(text('ＡＢＣＤで支払うと、さくらポイントも貯まります。'))),
      layout: [{ blockType: 'callout', body: 'ｷｬﾝﾍﾟｰﾝは今月末までです。' }],
      title: 'ＡＢＣＤキャンペーン',
    },
    locale: 'ja',
  })
  await payload.create({
    collection: 'notes',
    data: { body: '社内向け：さくらポイントの集計方法', title: '社内メモ' },
  })
}
