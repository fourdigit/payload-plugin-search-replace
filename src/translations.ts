/** Admin UI strings. Keys are used as `t('plugin-search-replace:<key>')`. */
export const translations = {
  en: {
    'plugin-search-replace': {
      apply: 'Replace selected',
      applyConfirm:
        'Replace {{matches}} matches in {{documents}} documents? Collections with drafts get a new draft; published versions do not change until the drafts are published.',
      applyDone:
        'Updated {{updated}} documents. Unchanged: {{unchanged}}, changed since search: {{stale}}, failed: {{error}}. Selected matches not replaced: {{skipped}}.',
      applying: 'Replacing…',
      caseSensitive: 'Match case',
      collections: 'Collections',
      deselectAll: 'Deselect all',
      edit: 'Edit',
      find: 'Find',
      findPlaceholder: 'Text to find',
      locale: 'Locale',
      manualCrossesNodes: 'Spans formatting or a link — fix by hand',
      manualPartialCharacter: 'Part of a combined character — fix by hand',
      maxApplyDocs: 'You can replace in up to {{max}} documents at once.',
      mode: 'Mode',
      modeRegex: 'Regular expression',
      modeText: 'Text',
      navLabel: 'Search & Replace',
      noCollectionsSelected: 'Select at least one collection.',
      noResults: 'No matches.',
      normalizeWidth: 'Ignore full-width / half-width',
      patternEmpty: 'Enter the text to find.',
      patternInvalid: 'Invalid regular expression: {{error}}',
      patternTooLong: 'The search text can be up to {{max}} characters.',
      regexHelp: 'Use $1 or $<name> in the replacement to insert groups.',
      regexNotAllowed: 'You are not allowed to search with regular expressions.',
      replace: 'Replace with',
      replacePlaceholder: 'Replacement (leave empty to delete)',
      search: 'Search',
      searchIndexDescription:
        'Text of the documents Search & Replace looks through, used to find candidates quickly. It is updated when documents are saved; reindex to add documents that existed before the plugin.',
      searchIndexPlural: 'Search index',
      searchIndexSingular: 'Search index entry',
      searching: 'Searching…',
      selectAll: 'Select all',
      staleDocument: 'The document changed after the search. Search again.',
      summary: '{{matches}} matches in {{documents}} documents ({{manual}} need manual fixes)',
      title: 'Search & Replace',
      untitled: 'Untitled',
    },
  },
  ja: {
    'plugin-search-replace': {
      apply: '選択した箇所を置換',
      applyConfirm:
        '{{documents}}件のドキュメントで{{matches}}箇所を置換します。下書きのあるコレクションは下書きとして保存され、公開するまで公開中の版は変わりません。',
      applyDone:
        '{{updated}}件を更新しました。変更なし: {{unchanged}}件、検索後に編集されたため飛ばした: {{stale}}件、失敗: {{error}}件。選択したうち置換されなかった箇所: {{skipped}}件。',
      applying: '置換しています…',
      caseSensitive: '大文字と小文字を区別',
      collections: 'コレクション',
      deselectAll: 'すべて外す',
      edit: '編集',
      find: '検索',
      findPlaceholder: '検索する文字列',
      locale: 'ロケール',
      manualCrossesNodes: '書式やリンクの境目をまたぐため手動で修正',
      manualPartialCharacter: '1文字の一部だけが一致するため手動で修正',
      maxApplyDocs: '一度に置換できるのは{{max}}件までです。',
      mode: '方式',
      modeRegex: '正規表現',
      modeText: '文字列',
      navLabel: '検索と置換',
      noCollectionsSelected: 'コレクションを1つ以上選んでください。',
      noResults: '一致する箇所はありません。',
      normalizeWidth: '全角と半角を区別しない',
      patternEmpty: '検索する文字列を入力してください。',
      patternInvalid: '正規表現が正しくありません: {{error}}',
      patternTooLong: '検索する文字列は{{max}}文字までです。',
      regexHelp: '置換後の文字列で $1 や $<name> を使うとグループを差し込めます。',
      regexNotAllowed: '正規表現で検索する権限がありません。',
      replace: '置換後',
      replacePlaceholder: '置換後の文字列（空にすると削除）',
      search: '検索',
      searchIndexDescription:
        '検索と置換が候補を素早く見つけるための、ドキュメント本文の索引です。保存時に更新されます。プラグイン導入前からあるドキュメントは再インデックスで追加してください。',
      searchIndexPlural: '検索インデックス',
      searchIndexSingular: '検索インデックス',
      searching: '検索しています…',
      selectAll: 'すべて選択',
      staleDocument: '検索後にドキュメントが変更されました。もう一度検索してください。',
      summary: '{{documents}}件のドキュメントで{{matches}}箇所（うち手動修正 {{manual}}箇所）',
      title: '検索と置換',
      untitled: '無題',
    },
  },
}

export type TranslationKey = keyof (typeof translations)['en']['plugin-search-replace']

/** `t('plugin-search-replace:<key>')`, typed to this plugin's keys. */
export const pluginT = (t: unknown, key: TranslationKey, vars?: Record<string, unknown>): string =>
  (t as (key: string, vars?: Record<string, unknown>) => string)(`plugin-search-replace:${key}`, vars)
