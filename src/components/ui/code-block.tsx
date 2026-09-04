import type { HTMLProps, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '../../lib/utils.js'

export type CodeBlockProps = HTMLProps<HTMLDivElement> & { children?: ReactNode }

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      data-slot="code-block"
      className={cn('not-prose flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground', className)}
      {...props}
    >
      {children}
    </div>
  )
}

/** Longest code block still worth highlighting; beyond it the plain fallback renders. */
const MAX_HIGHLIGHT_CHARS = 20_000

export type CodeBlockCodeProps = HTMLProps<HTMLDivElement> & {
  code: string
  language?: string
  theme?: string
}

function CodeBlockCode({ code, language = 'plaintext', theme = 'github-dark-default', className, ...props }: CodeBlockCodeProps) {
  const [highlighted, setHighlighted] = useState<{
    code: string; language: string; theme: string; html: string
  } | null>(null)
  const lastUpdateRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Grammar matching is linear in the source, on the UI thread. A pasted file or a long tool
    // output would hold a frame for as long as it takes; past this it stays plain text.
    if (code.length > MAX_HIGHLIGHT_CHARS) {
      setHighlighted(null)
      return
    }
    let active = true
    const run = () => {
      lastUpdateRef.current = Date.now()
      void import('./code-highlighter.js')
        .then(({ highlightCode }) => highlightCode(code, language, theme))
        .then((html) => {
          if (active) setHighlighted({ code, language, theme, html })
        })
        .catch(() => {
          if (active) setHighlighted(null)
        })
    }

    const elapsed = Date.now() - lastUpdateRef.current
    if (elapsed > 250) {
      run()
    } else {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(run, 250 - elapsed)
    }

    return () => {
      active = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [code, language, theme])

  const classes = cn('w-full overflow-x-auto text-[12px] [&>pre]:m-0 [&>pre]:px-4 [&>pre]:py-3', className)
  // Highlighting may lag the stream, but text must not. Only display HTML for these exact
  // inputs; while a newer highlight is pending, the plain fallback shows the current source.
  const highlightedHtml = highlighted?.code === code && highlighted.language === language && highlighted.theme === theme
    ? highlighted.html : null
  return highlightedHtml
    ? <div className={classes} dangerouslySetInnerHTML={{ __html: highlightedHtml }} {...props} />
    : <div className={classes} {...props}><pre><code>{code}</code></pre></div>
}

function CodeBlockGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between', className)} {...props} />
}

export { CodeBlock, CodeBlockCode, CodeBlockGroup }
