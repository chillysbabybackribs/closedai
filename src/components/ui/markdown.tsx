import { Check, Copy } from 'lucide-react'
import { createElement, memo, useCallback, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components, type ExtraProps } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

import { cn } from '../../lib/utils.js'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table.js'
import { Source, SourceContent, SourceTrigger } from '../prompt-kit/source.js'
import { CodeBlock, CodeBlockCode } from './code-block.js'
import { remarkBareUrls } from './markdown-links.js'
import { splitMarkdownIntoBlocks } from './markdown-blocks.js'
import { closeIncompleteMarkdown } from './markdown-stream.js'
import { isWorkspaceFileHref, localFilePath } from '../../shared/local-files.js'
import type { PluggableList } from 'unified'

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Partial<Components>
  /** Still-streaming text: the trailing block's unfinished inline syntax is closed before lexing. */
  streaming?: boolean
  remarkPlugins?: PluggableList
  /** Override href normalization for local and workspace file links. */
  urlTransform?: (url: string, key: string) => string
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
  'ul', 'ol', 'li', 'hr', 'strong', 'sup'
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

export function MarkdownLink({ href, children, node: _node, ...props }: React.ComponentProps<'a'> & ExtraProps) {
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

/* Numbers, percentages, money and durations right-align under each other; anything with
   letters beyond a unit suffix stays a label. */
const NUMERIC_CELL = /^[-+−]?[$€£¥]?\d[\d,]*(\.\d+)?\s?(%|[kKmMbB]|ms|s|min|h|x|×|GB|MB|KB|TB)?$/

type CellProps = TaggedProps & { style?: CSSProperties }

/* remark-gfm carries a column's `---:` alignment as an inline text-align; a numeric cell in an
   unaligned column right-aligns on its own. */
const cellAlign = (style: CSSProperties | undefined, numeric = false) =>
  style?.textAlign === 'right' || (numeric && !style?.textAlign) ? 'text-right' : style?.textAlign === 'center' ? 'text-center' : undefined

const DEFAULT_COMPONENTS: Partial<Components> = {
  ...TAGGED_COMPONENTS,
  // Markdown tables are the stock shadcn Table. Body cells wrap at spaces (GitHub's markdown
  // behaviour) instead of shadcn's nowrap so a prose column does not force a scrollbar, but a
  // word is never broken: a table that does not fit scrolls inside its frame.
  table: function TableComponent({ node: _node, className, ...props }: TaggedProps) {
    return (
      <div className="not-prose my-4">
        <Table className={cn('aui-md-table', className)} {...props} />
      </div>
    )
  },
  thead: function HeadComponent({ node: _node, ...props }: TaggedProps) { return <TableHeader {...props} /> },
  tbody: function BodyComponent({ node: _node, ...props }: TaggedProps) { return <TableBody {...props} /> },
  tr: function RowComponent({ node: _node, ...props }: TaggedProps) { return <TableRow {...props} /> },
  th: function HeadCellComponent({ node: _node, style, className, ...props }: CellProps) {
    return <TableHead className={cn('text-muted-foreground px-3 py-2 text-xs font-medium', cellAlign(style), className)} {...props} />
  },
  td: function CellComponent({ node: _node, style, className, children, ...props }: CellProps) {
    const numeric = NUMERIC_CELL.test(textContent(children).trim())
    return <TableCell className={cn('px-3 py-2 align-top whitespace-normal', numeric && 'tabular-nums whitespace-nowrap', cellAlign(style, numeric), className)} {...props}>{children}</TableCell>
  },
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

const DEFAULT_REMARK_PLUGINS = [remarkGfm, remarkBreaks, remarkBareUrls]

function chatUrlTransform(url: string, key: string): string {
  return key === 'href' && (localFilePath(url) || isWorkspaceFileHref(url)) ? url : defaultUrlTransform(url)
}

const MarkdownBlock = memo(function MarkdownBlock({ content, components, remarkPlugins, urlTransform }: {
  content: string
  components: Partial<Components>
  remarkPlugins: PluggableList
  urlTransform: (url: string, key: string) => string
}) {
  return <ReactMarkdown urlTransform={urlTransform} remarkPlugins={remarkPlugins} components={components}>{content}</ReactMarkdown>
}, (previous, next) => previous.content === next.content && previous.components === next.components && previous.remarkPlugins === next.remarkPlugins)

function MarkdownComponent({ children, id, className, components, streaming = false, remarkPlugins, urlTransform }: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId
  const blockCache = useRef<ReturnType<typeof splitMarkdownIntoBlocks> | null>(null)

  // Chat events already arrive in animation-frame batches. Lex their latest text in the same
  // render, keeping completed blocks memoized without a second timer or stale final frame.
  // While streaming, only the trailing block can be mid-token; earlier blocks are settled.
  const blocks = useMemo(() => {
    const split = splitMarkdownIntoBlocks(children, streaming, blockCache.current)
    blockCache.current = split
    const parsed = [...split.blocks]
    if (streaming && parsed.length > 0) {
      parsed[parsed.length - 1] = closeIncompleteMarkdown(parsed[parsed.length - 1]!)
    }
    return parsed
  }, [children, streaming])

  const mergedComponents = useMemo(() => ({ ...DEFAULT_COMPONENTS, ...components }), [components])
  const plugins = remarkPlugins ?? DEFAULT_REMARK_PLUGINS
  const transform = urlTransform ?? chatUrlTransform
  return (
    <div data-slot="markdown" className={cn('aui-md prompt-markdown', className)}>
      {blocks.map((block, index) => (
        <MarkdownBlock key={`${blockId}-${index}`} content={block} components={mergedComponents} remarkPlugins={plugins} urlTransform={transform} />
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
