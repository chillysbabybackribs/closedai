import { marked } from 'marked'
import { memo, type ReactNode, useId, useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

import { cn } from '../../lib/utils.js'
import { Source, SourceContent, SourceTrigger } from '../prompt-kit/source.js'
import { CodeBlock, CodeBlockCode } from './code-block.js'

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

const DEFAULT_COMPONENTS: Partial<Components> = {
  a: function LinkComponent({ href, children, node: _node, ...props }) {
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
        href={undefined}
        onClick={(event) => {
          event.preventDefault()
        }}
        {...props}
      >
        {children}
      </a>
    )
  },
  code: function CodeComponent({ className, children, node: _node, ...props }) {
    const code = String(children).replace(/\n$/, '')
    const multiline = code.includes('\n') || className?.includes('language-')
    if (!multiline) return <code className={cn('prompt-markdown-inline-code', className)} {...props}>{children}</code>
    return (
      <CodeBlock className={className}>
        <CodeBlockCode code={code} language={extractLanguage(className)} />
      </CodeBlock>
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
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>{content}</ReactMarkdown>
}, (previous, next) => previous.content === next.content && previous.components === next.components)

function MarkdownComponent({ children, id, className, components }: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children])
  const mergedComponents = useMemo(() => ({ ...DEFAULT_COMPONENTS, ...components }), [components])
  return (
    <div data-slot="markdown" className={cn('prompt-markdown', className)}>
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
