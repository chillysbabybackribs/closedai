import { Check, Copy } from 'lucide-react'
import { marked } from 'marked'
import { createElement, memo, useCallback, useId, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

import { cn } from '../../lib/utils.js'
import { Source, SourceContent, SourceTrigger } from '../prompt-kit/source.js'
import { CodeBlock, CodeBlockCode } from './code-block.js'
import { remarkBareUrls } from './markdown-links.js'
import { localFilePath } from '../../shared/local-files.js'

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Partial<Components>
}

function parseMarkdownIntoBlocks(markdown: string): string[] {
  try {
    return marked.lexer(markdown).map((token) => token.raw)
  } catch {
    return [markdown]
  }
}

function extractLanguage(className?: string): string {
  return className?.match(/language-([\w-]+)/)?.[1] ?? 'plaintext'
}

/* The element set the assistant-ui "markdown-text" renderer tags
   (assistant-ui.com/elements/markdown-text). Every block carries an aui-md-*
   class so one of them can be restyled without replacing the whole set; the
   styling itself lives in styles/chat/markdown.css. */
const TAGGED_ELEMENTS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote',
  'ul', 'ol', 'li', 'hr', 'table', 'th', 'td', 'tr', 'strong', 'sup'
] as const

type TaggedProps = { node?: unknown; className?: string; children?: ReactNode }

const TAGGED_COMPONENTS = Object.fromEntries(TAGGED_ELEMENTS.map((tag) => [
  tag,
  function Tagged({ node: _node, className, ...props }: TaggedProps) {
    return createElement(tag, { ...props, className: cn(`aui-md-${tag}`, className) })
  }
])) as unknown as Partial<Components>

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    // A file:// renderer is not a secure context, so the async clipboard API can be missing.
    const field = document.createElement('textarea')
    field.value = value
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.append(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    return copied
  }
}

function CodeHeader({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(() => {
    if (copied) return
    void copyText(code).then((done) => {
      if (!done) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 3000)
    })
  }, [code, copied])

  return (
    <div className="aui-code-header-root">
      <span className="aui-code-header-language">{language}</span>
      <button type="button" className="aui-code-header-copy" aria-label="Copy" onClick={onCopy}>
        {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      </button>
    </div>
  )
}

export const MarkdownLink: NonNullable<Components['a']> = function LinkComponent({ href, children, node: _node, ...props }) {
    const safeHref = safeWebUrl(href)
    if (safeHref) {
      const title = textContent(children) || hostname(safeHref)
      return (
        <Source href={safeHref} onNavigate={(url) => void window.closedai.browser.openTab(url)}>
          <SourceTrigger showFavicon />
          <SourceContent title={title} description={props.title ?? safeHref} />
        </Source>
      )
    }
    return (
      <a
        className="aui-md-a"
        href={undefined}
        onClick={(event) => {
          event.preventDefault()
        }}
        {...props}
      >
        {children}
      </a>
    )
}

const DEFAULT_COMPONENTS: Partial<Components> = {
  ...TAGGED_COMPONENTS,
  a: MarkdownLink,
  code: function CodeComponent({ className, children, node: _node, ...props }) {
    const code = String(children).replace(/\n$/, '')
    const multiline = code.includes('\n') || className?.includes('language-')
    if (!multiline) return <code className={cn('aui-md-inline-code', className)} {...props}>{children}</code>
    const language = extractLanguage(className)
    return (
      <div className="aui-md-code">
        <CodeHeader language={language} code={code} />
        <CodeBlock className={cn('aui-md-pre', className)}>
          <CodeBlockCode className="aui-md-code-body" code={code} language={language} />
        </CodeBlock>
      </div>
    )
  },
  pre: function PreComponent({ children }) {
    return <>{children}</>
  }
}

function textContent(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textContent).join('')
  return ''
}

function hostname(href: string): string {
  return new URL(href).hostname.replace(/^www\./, '')
}

const MarkdownBlock = memo(function MarkdownBlock({ content, components }: { content: string; components: Partial<Components> }) {
  return <ReactMarkdown urlTransform={(url, key) => key === 'href' && localFilePath(url) ? url : defaultUrlTransform(url)} remarkPlugins={[remarkGfm, remarkBreaks, remarkBareUrls]} components={components}>{content}</ReactMarkdown>
}, (previous, next) => previous.content === next.content && previous.components === next.components)

function MarkdownComponent({ children, id, className, components }: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId

  // Chat events already arrive in animation-frame batches. Lex their latest text in the same
  // render, keeping completed blocks memoized without a second timer or stale final frame.
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children])

  const mergedComponents = useMemo(() => ({ ...DEFAULT_COMPONENTS, ...components }), [components])
  return (
    <div data-slot="markdown" className={cn('aui-md prompt-markdown', className)}>
      {blocks.map((block, index) => (
        <MarkdownBlock key={`${blockId}-${index}`} content={block} components={mergedComponents} />
      ))}
    </div>
  )
}

function safeWebUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = 'Markdown'

export { Markdown }
