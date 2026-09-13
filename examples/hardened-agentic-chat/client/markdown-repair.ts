/**
 * Hardened streaming markdown repair and sanitization utilities.
 *
 * During live LLM streaming, text chunks arrive token-by-token. This causes
 * intermediate syntax states (unclosed code fences, dangling link brackets,
 * half-formed tables) that crash standard parsers, cause layout flicker,
 * or leak unformatted syntax tokens.
 */

export interface MarkdownRepairResult {
  /** Repaired text ready for markdown parser */
  repairedText: string
  /** Whether the stream is currently inside an open code block */
  isInsideCodeBlock: boolean
  /** Active language detected in the open code block (if any) */
  activeLanguage?: string
}

/**
 * Repairs incomplete markdown syntax for safe, flicker-free streaming rendering.
 */
export function repairStreamingMarkdown(input: string): MarkdownRepairResult {
  if (!input) {
    return { repairedText: '', isInsideCodeBlock: false }
  }

  let text = input
  let isInsideCodeBlock = false
  let activeLanguage: string | undefined

  // 1. Analyze code fences: ``` or ~~~
  const fenceMatches = [...text.matchAll(/^([ \t]*)(`{3,}|~{3,})([a-zA-Z0-9_-]*)/gm)]

  if (fenceMatches.length % 2 !== 0) {
    // An odd number of fences means a code block is currently open!
    isInsideCodeBlock = true
    const lastFence = fenceMatches[fenceMatches.length - 1]
    const fenceChars = lastFence[2]
    activeLanguage = lastFence[3] || undefined

    // Append synthetic closing fence
    // Ensure trailing newline before closing fence if last char isn't a newline
    const needsNewline = !text.endsWith('\n')
    text = `${text}${needsNewline ? '\n' : ''}${fenceChars}\n`
  }

  // 2. If NOT inside a code block, repair inline constructs
  if (!isInsideCodeBlock) {
    // Repair dangling incomplete links: e.g. [text](https://incomplete
    // If there is an unclosed link target [text](url without closing )
    const openLinkMatch = text.match(/\[([^\]]+)\]\(([^)\s]*)$/)
    if (openLinkMatch) {
      // Complete the link parenthesis synthetically
      text = `${text})`
    } else {
      // Dangling link label without URL: e.g. [text
      const openBracketMatch = text.match(/\[([^\]\n]+)$/)
      if (openBracketMatch) {
        // Suppress or close the bracket so it renders cleanly as text
        text = `${text}]`
      }
    }

    // Repair incomplete markdown table row
    // If the line looks like a table row starting with `|` but doesn't end with `|` or `|\n`
    const lines = text.split('\n')
    const lastLine = lines[lines.length - 1]
    if (lastLine.trim().startsWith('|') && !lastLine.trim().endsWith('|')) {
      lines[lines.length - 1] = `${lastLine} |`
      text = lines.join('\n')
    }

    // Repair unclosed inline code backtick (odd number of backticks outside code blocks)
    // Strip code blocks first to count inline backticks
    const textWithoutCode = text.replace(/`{3,}[\s\S]*?`{3,}/g, '')
    const singleBackticks = (textWithoutCode.match(/(?<!`)`(?!`)/g) || []).length
    if (singleBackticks % 2 !== 0) {
      text = `${text}\``
    }

    // Repair unclosed bold **
    const boldTokens = (textWithoutCode.match(/\*\*/g) || []).length
    if (boldTokens % 2 !== 0) {
      text = `${text}**`
    }
  }

  return {
    repairedText: text,
    isInsideCodeBlock,
    activeLanguage
  }
}

/**
 * Sanitizes potentially malicious HTML or javascript: URIs in LLM-generated markdown.
 */
export function sanitizeMarkdownContent(content: string): string {
  if (!content) return ''

  // Disallow javascript:, vbscript:, data: text/html in link destinations
  let sanitized = content.replace(
    /\]\(\s*(javascript|vbscript|data):[^)]*\)/gi,
    '](#blocked-unsafe-link)'
  )

  // Disallow raw <script>, <style>, <iframe>, <embed>, <object> tags
  sanitized = sanitized.replace(
    /<(script|style|iframe|embed|object|base|applet)[\s\S]*?<\/\1>/gi,
    ''
  )
  sanitized = sanitized.replace(
    /<(script|style|iframe|embed|object|base|applet)[\s\S]*?>/gi,
    ''
  )

  // Strip inline onerror/onload/onmouseover event handlers in any raw HTML tags
  sanitized = sanitized.replace(
    /(<[a-zA-Z0-9]+[^>]*?)\s+on[a-zA-Z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi,
    '$1'
  )

  return sanitized
}
