import { RE2JS } from 're2js'

export type MatchMode = 'regex' | 'text'

export type MatchOptions = {
  caseSensitive: boolean
  mode: MatchMode
  /**
   * Treat full-width and half-width forms as equal (Unicode NFKC), e.g. `ＡＢＣ` = `ABC`, `ｶﾞ` = `ガ`.
   * Matches are reported in the original text; only the matched range is replaced.
   */
  normalizeWidth: boolean
}

export type TextMatch = {
  /** End offset in the original text (exclusive). */
  end: number
  /**
   * The match covers only part of a character that NFKC expands to several (e.g. `平` in `㍻`).
   * Replacing would remove the whole original character, so it is left for manual fixing.
   */
  partial: boolean
  /** The text the replacement will insert for this match. */
  replacement: string
  /** Start offset in the original text. */
  start: number
  /** The original text in `[start, end)`. */
  text: string
}

export class InvalidPatternError extends Error {
  constructor(
    message: string,
    /** Translation key for the admin, with `data` as its variables. */
    public readonly key: 'patternEmpty' | 'patternInvalid' | 'patternTooLong',
    public readonly data: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'InvalidPatternError'
  }
}

export const MAX_PATTERN_LENGTH = 500

/**
 * Maps each character to one representative of the characters RE2 treats as equal when
 * ignoring case (upper-case it, then lower-case it, one code point at a time): `ſ` → `s`,
 * `ς` → `σ`, `K` (Kelvin) → `k`, `ᲀ` → `в`. Done per character, so final sigma does not depend
 * on context. Checked against RE2 for every code point up to U+1FFFF.
 */
export const foldCase = (value: string): string =>
  Array.from(value, (char) => {
    const upper = char.toUpperCase()
    if (Array.from(upper).length === 1) {
      const folded = upper.toLowerCase()
      if (Array.from(folded).length === 1) {
        return folded
      }
    }
    const lower = char.toLowerCase()
    return Array.from(lower).length === 1 ? lower : char
  }).join('')

/** Case-folded. The index that narrows candidates when width is not ignored. */
export const foldForIndex = (value: string): string => foldCase(value)

/** NFKC, then case-folded. The index that narrows candidates when width is ignored. */
export const normalizeForIndex = (value: string): string => foldCase(value.normalize('NFKC'))

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

type NormalizedText = {
  /** Per normalized offset: the original range of the character (grapheme) it came from. */
  originalEnd: number[]
  originalStart: number[]
  text: string
  /** Per normalized offset: where that character's normalized form starts and ends. */
  unitNormalizedEnd: number[]
  unitNormalizedStart: number[]
}

/**
 * Normalizes `value` with NFKC one grapheme at a time, keeping a map from normalized offsets
 * back to the original. A grapheme keeps base characters and the marks that attach to them
 * together (`ｶﾞ` → `ガ`, Hangul jamo → syllable), so each maps back as a whole.
 */
const normalizeWithMap = (value: string): NormalizedText => {
  const result: NormalizedText = {
    originalEnd: [],
    originalStart: [],
    text: '',
    unitNormalizedEnd: [],
    unitNormalizedStart: [],
  }

  for (const { index, segment } of graphemes.segment(value)) {
    const normalized = segment.normalize('NFKC')
    const unitStart = result.text.length
    const unitEnd = unitStart + normalized.length
    for (let i = 0; i < normalized.length; i++) {
      result.originalStart.push(index)
      result.originalEnd.push(index + segment.length)
      result.unitNormalizedStart.push(unitStart)
      result.unitNormalizedEnd.push(unitEnd)
    }
    result.text += normalized
  }

  return result
}

type Groups = {
  count: number
  get: (key: number | string) => null | string
  names: Record<string, number>
}

/**
 * Expands a replacement like `String.prototype.replace` does: `$$`, `$&`, `$n` / `$nn`
 * (two digits only when that group exists) and `$<name>` (literal when the pattern has no
 * named groups).
 */
const expandReplacement = (template: string, groups: Groups): string => {
  const hasNames = Object.keys(groups.names).length > 0
  let out = ''

  for (let i = 0; i < template.length; i++) {
    const char = template[i]
    const next = template[i + 1]
    if (char !== '$' || next === undefined) {
      out += char
      continue
    }

    if (next === '$') {
      out += '$'
      i++
    } else if (next === '&') {
      out += groups.get(0) ?? ''
      i++
    } else if (/\d/.test(next)) {
      const two = template.slice(i + 1, i + 3)
      const oneDigit = Number(next)
      if (/^\d\d$/.test(two) && Number(two) >= 1 && Number(two) <= groups.count) {
        out += groups.get(Number(two)) ?? ''
        i += 2
      } else if (oneDigit >= 1 && oneDigit <= groups.count) {
        out += groups.get(oneDigit) ?? ''
        i++
      } else {
        out += char
      }
    } else if (next === '<' && hasNames) {
      const close = template.indexOf('>', i + 2)
      if (close === -1) {
        out += char
        continue
      }
      const name = template.slice(i + 2, close)
      out += name in groups.names ? (groups.get(name) ?? '') : ''
      i = close
    } else {
      out += char
    }
  }

  return out
}

export type Matcher = {
  findAll: (text: string) => TextMatch[]
  options: MatchOptions
}

/**
 * Builds a matcher on RE2 (linear time, no catastrophic backtracking). Regular expressions use
 * RE2 syntax: no backreferences or lookaround. Throws `InvalidPatternError` for an empty, too
 * long or malformed pattern.
 */
export const createMatcher = ({
  find,
  options,
  replace,
}: {
  find: string
  options: MatchOptions
  replace: string
}): Matcher => {
  if (!find) {
    throw new InvalidPatternError('The search text is empty.', 'patternEmpty')
  }
  if (find.length > MAX_PATTERN_LENGTH) {
    throw new InvalidPatternError(
      `The search text is longer than ${MAX_PATTERN_LENGTH} characters.`,
      'patternTooLong',
      { max: MAX_PATTERN_LENGTH },
    )
  }

  const flags = options.caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE
  let pattern: RE2JS
  try {
    pattern =
      options.mode === 'regex'
        ? RE2JS.compile(find, flags)
        : RE2JS.compile(RE2JS.quote(options.normalizeWidth ? find.normalize('NFKC') : find), flags)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new InvalidPatternError(message, 'patternInvalid', { error: message })
  }
  const names = pattern.namedGroups()

  const findAll = (original: string): TextMatch[] => {
    const normalized = options.normalizeWidth ? normalizeWithMap(original) : undefined
    const haystack = normalized ? normalized.text : original
    const matches: TextMatch[] = []

    const matcher = pattern.matcher(haystack)
    while (matcher.find()) {
      const matchStart = matcher.start()
      const matchEnd = matcher.end()
      if (matchEnd === matchStart) {
        continue
      }

      let start = matchStart
      let end = matchEnd
      let partial = false
      if (normalized) {
        start = normalized.originalStart[matchStart]!
        end = normalized.originalEnd[matchEnd - 1]!
        partial =
          normalized.unitNormalizedStart[matchStart] !== matchStart ||
          normalized.unitNormalizedEnd[matchEnd - 1] !== matchEnd
      }

      const previous = matches[matches.length - 1]
      if (previous && start < previous.end) {
        // Two normalized matches fell inside the same original character.
        continue
      }

      matches.push({
        end,
        partial,
        replacement:
          options.mode === 'regex'
            ? expandReplacement(replace, {
                count: matcher.groupCount(),
                get: (key) => matcher.group(key),
                names,
              })
            : replace,
        start,
        text: original.slice(start, end),
      })
    }

    return matches
  }

  return { findAll, options }
}
