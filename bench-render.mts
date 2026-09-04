import { loadClaudeSdk } from './src/main/claude/claude-sdk.js'
import { replayClaudeSession } from './src/main/claude/claude-history.js'
import { marked } from 'marked'

const sessionId = process.argv[2]!
const cwd = '/home/dp/Desktop/closedai'
const sdk = await loadClaudeSdk()
const all = await replayClaudeSession(sdk, sessionId, { cwd, displayScreenshot: () => null })
// what the renderer actually receives: last 200 items
const items = all.slice(-200)
const texts: string[] = []
for (const item of items as any[]) {
  if (typeof item.text === 'string') texts.push(item.text)
  if (typeof item.output === 'string') texts.push(item.output)
}
const t0 = performance.now()
const blocks = texts.flatMap((t) => marked.lexer(t).map((tok) => tok.raw))
const lexMs = performance.now() - t0
const codeTokens: { code: string; lang: string }[] = []
for (const t of texts) for (const tok of marked.lexer(t) as any[]) {
  if (tok.type === 'code') codeTokens.push({ code: tok.text as string, lang: (tok.lang as string) || 'plaintext' })
}

const t1 = performance.now()
const { highlightCode } = await import('./src/components/ui/code-highlighter.js')
await highlightCode('const a = 1', 'typescript', 'github-dark-default')
const warmMs = performance.now() - t1

const t2 = performance.now()
for (const c of codeTokens) await highlightCode(c.code, c.lang, 'github-dark-default')
const hlMs = performance.now() - t2

console.log(JSON.stringify({
  itemsRendered: items.length,
  markdownTexts: texts.length,
  markdownBlocks: blocks.length,
  markdownLexMs: +lexMs.toFixed(0),
  codeBlocks: codeTokens.length,
  codeChars: codeTokens.reduce((n, c) => n + c.code.length, 0),
  shikiFirstUseMs: +warmMs.toFixed(0),
  shikiAllBlocksMs: +hlMs.toFixed(0)
}, null, 2))
