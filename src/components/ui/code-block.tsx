import type { HTMLProps, ReactNode } from 'react'
import { useEffect, useState } from 'react'

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

export type CodeBlockCodeProps = HTMLProps<HTMLDivElement> & {
  code: string
  language?: string
  theme?: string
}

function CodeBlockCode({ code, language = 'plaintext', theme = 'github-dark-default', className, ...props }: CodeBlockCodeProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setHighlightedHtml(null)
    void import('./code-highlighter.js')
      .then(({ highlightCode }) => highlightCode(code, language, theme))
      .then((html) => {
        if (active) setHighlightedHtml(html)
      })
      .catch(() => {
        if (active) setHighlightedHtml(null)
      })
    return () => { active = false }
  }, [code, language, theme])

  const classes = cn('w-full overflow-x-auto text-[12px] [&>pre]:m-0 [&>pre]:px-4 [&>pre]:py-3', className)
  return highlightedHtml
    ? <div className={classes} dangerouslySetInnerHTML={{ __html: highlightedHtml }} {...props} />
    : <div className={classes} {...props}><pre><code>{code}</code></pre></div>
}

function CodeBlockGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between', className)} {...props} />
}

export { CodeBlock, CodeBlockCode, CodeBlockGroup }
