import type { TextMatch } from './matcher.js'

type LexicalNode = {
  [key: string]: unknown
  children?: LexicalNode[]
  text?: string
  type?: string
}

/** Inline element nodes whose text flows together with the surrounding text. */
const INLINE_ELEMENT_TYPES = new Set(['autolink', 'link'])

/**
 * Stands in for nodes without text inside a run (inline blocks, uploads…) so text on either
 * side does not join into one match. Replaced by a space in the index text.
 */
export const OBJECT_PLACEHOLDER = '\uFFFC'

type Segment =
  | { end: number; kind: 'break'; start: number }
  | { end: number; kind: 'text'; node: LexicalNode; nodePath: number[]; start: number }

/** A run of inline text inside one block (paragraph, heading, list item…). */
export type TextRun = {
  segments: Segment[]
  text: string
}

const isTextNode = (node: LexicalNode): boolean => typeof node.text === 'string'

/**
 * Splits a Lexical editor state into runs of inline text. Text inside `link` / `autolink`
 * joins the surrounding run; any other element with children starts a new run. Line breaks
 * become `\n`, other nodes without text a placeholder. Fields inside Payload block nodes are
 * not included.
 */
export const collectTextRuns = (editorState: unknown): TextRun[] => {
  const root = (editorState as { root?: LexicalNode } | undefined)?.root
  const runs: TextRun[] = []
  if (!root) {
    return runs
  }

  const visitBlock = (node: LexicalNode, nodePath: number[]): void => {
    let current: TextRun = { segments: [], text: '' }

    const flush = () => {
      if (current.segments.some((segment) => segment.kind === 'text')) {
        runs.push(current)
      }
      current = { segments: [], text: '' }
    }

    const addInline = (child: LexicalNode, childPath: number[]) => {
      if (isTextNode(child)) {
        const start = current.text.length
        current.text += child.text
        current.segments.push({
          end: current.text.length,
          kind: 'text',
          node: child,
          nodePath: childPath,
          start,
        })
        return
      }
      if (child.type && INLINE_ELEMENT_TYPES.has(child.type)) {
        child.children?.forEach((grandchild, index) => addInline(grandchild, [...childPath, index]))
        return
      }
      if (Array.isArray(child.children)) {
        flush()
        visitBlock(child, childPath)
        return
      }
      const start = current.text.length
      current.text += child.type === 'linebreak' ? '\n' : OBJECT_PLACEHOLDER
      current.segments.push({ end: current.text.length, kind: 'break', start })
    }

    node.children?.forEach((child, index) => addInline(child, [...nodePath, index]))
    flush()
  }

  visitBlock(root, [])
  return runs
}

/** Concatenates all runs, one per line. Used for the search index. */
export const lexicalToPlainText = (editorState: unknown): string =>
  collectTextRuns(editorState)
    .map((run) => run.text.replaceAll(OBJECT_PLACEHOLDER, ' '))
    .join('\n')

export type LexicalMatchLocation =
  | {
      crossesNodes: false
      /** Offsets inside the text node. */
      localEnd: number
      localStart: number
      nodePath: number[]
    }
  | { crossesNodes: true }

/** Where a match on `run.text` lands: inside one text node, or across several. */
export const locateInRun = (run: TextRun, match: TextMatch): LexicalMatchLocation => {
  const segment = run.segments.find(
    (candidate) =>
      candidate.kind === 'text' && candidate.start <= match.start && match.end <= candidate.end,
  )
  if (!segment || segment.kind !== 'text') {
    return { crossesNodes: true }
  }
  return {
    crossesNodes: false,
    localEnd: match.end - segment.start,
    localStart: match.start - segment.start,
    nodePath: segment.nodePath,
  }
}

export type LexicalReplacement = {
  localEnd: number
  localStart: number
  nodePath: number[]
  original: string
  replacement: string
}

const getNode = (root: LexicalNode, nodePath: number[]): LexicalNode | undefined =>
  nodePath.reduce<LexicalNode | undefined>((node, index) => node?.children?.[index], root)

/**
 * Returns a copy of the editor state with the replacements applied. Replacements whose
 * text no longer matches are returned in `skipped`.
 */
export const applyLexicalReplacements = (
  editorState: unknown,
  replacements: LexicalReplacement[],
): { skipped: LexicalReplacement[]; value: unknown } => {
  const value = structuredClone(editorState) as { root: LexicalNode }
  const skipped: LexicalReplacement[] = []

  // Apply from the end of each node so earlier offsets stay valid.
  const ordered = [...replacements].sort((a, b) => {
    const pathA = a.nodePath.join('.')
    const pathB = b.nodePath.join('.')
    return pathA === pathB ? b.localStart - a.localStart : pathA.localeCompare(pathB)
  })

  for (const replacement of ordered) {
    const node = getNode(value.root, replacement.nodePath)
    const text = node?.text
    if (
      !node ||
      typeof text !== 'string' ||
      text.slice(replacement.localStart, replacement.localEnd) !== replacement.original
    ) {
      skipped.push(replacement)
      continue
    }
    node.text =
      text.slice(0, replacement.localStart) + replacement.replacement + text.slice(replacement.localEnd)
  }

  return { skipped, value }
}
