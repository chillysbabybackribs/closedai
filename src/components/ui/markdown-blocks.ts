import { marked } from 'marked'

export type MarkdownBlockCache = {
  markdown: string
  blocks: string[]
}

/** Lex markdown into block-sized strings (marked token `raw` segments). */
export function lexMarkdownBlocks(markdown: string): string[] {
  try {
    return marked.lexer(markdown).map((token) => token.raw)
  } catch {
    return [markdown]
  }
}

/**
 * Split markdown into blocks, reusing settled blocks while the tail grows during streaming.
 * Falls back to a full lex when the text shrinks, edits mid-document, or streaming ends.
 */
export function splitMarkdownIntoBlocks(
  markdown: string,
  streaming: boolean,
  cache: MarkdownBlockCache | null
): MarkdownBlockCache {
  if (cache?.markdown === markdown) return cache

  const canReuse = streaming
    && cache
    && cache.blocks.length > 0
    && markdown.startsWith(cache.markdown)
    && markdown.length >= cache.markdown.length

  if (canReuse) {
    const settled = cache.blocks.slice(0, -1)
    const prefix = settled.join('')
    if (markdown.startsWith(prefix)) {
      const tail = markdown.slice(prefix.length)
      const tailBlocks = tail ? lexMarkdownBlocks(tail) : []
      const blocks = tailBlocks.length > 0 ? [...settled, ...tailBlocks] : settled.length > 0 ? settled : lexMarkdownBlocks(markdown)
      return { markdown, blocks }
    }
  }

  return { markdown, blocks: lexMarkdownBlocks(markdown) }
}
