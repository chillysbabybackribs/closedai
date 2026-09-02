import { createContext, type MouseEvent, type ReactNode, useContext } from 'react'

import { cn } from '../../lib/utils.js'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card.js'

type SourceContextValue = {
  href: string
  domain: string
  onNavigate?: (href: string) => void
}

const SourceContext = createContext<SourceContextValue | null>(null)

function useSourceContext(): SourceContextValue {
  const context = useContext(SourceContext)
  if (!context) throw new Error('Source.* must be used inside <Source>')
  return context
}

export type SourceProps = {
  href: string
  children: ReactNode
  onNavigate?: (href: string) => void
}

export function Source({ href, children, onNavigate }: SourceProps) {
  let domain = href
  try {
    domain = new URL(href).hostname
  } catch {
    domain = href.split('/').pop() || href
  }

  return (
    <SourceContext.Provider value={{ href, domain, onNavigate }}>
      <HoverCard openDelay={150} closeDelay={0}>{children}</HoverCard>
    </SourceContext.Provider>
  )
}

export type SourceTriggerProps = {
  label?: string | number
  showFavicon?: boolean
  className?: string
}

export function SourceTrigger({ label, showFavicon = false, className }: SourceTriggerProps) {
  const source = useSourceContext()
  const labelToShow = label ?? source.domain.replace(/^www\./, '')

  return (
    <HoverCardTrigger asChild>
      <a
        href={source.href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn('prompt-source-trigger', showFavicon && 'prompt-source-trigger-favicon', className)}
        onClick={(event) => navigate(event, source)}
      >
        {showFavicon && <SourceFavicon href={source.href} size={14} />}
        <span>{labelToShow}</span>
      </a>
    </HoverCardTrigger>
  )
}

export type SourceContentProps = {
  title: string
  description: string
  className?: string
}

export function SourceContent({ title, description, className }: SourceContentProps) {
  const source = useSourceContext()
  return (
    <HoverCardContent className={cn('prompt-source-content', className)}>
      <a
        href={source.href}
        target="_blank"
        rel="noopener noreferrer"
        className="prompt-source-preview"
        onClick={(event) => navigate(event, source)}
      >
        <div className="prompt-source-domain">
          <SourceFavicon href={source.href} size={16} />
          <span>{source.domain.replace(/^www\./, '')}</span>
        </div>
        <strong>{title}</strong>
        <p>{description}</p>
      </a>
    </HoverCardContent>
  )
}

function SourceFavicon({ href, size }: { href: string; size: number }) {
  const favicon = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(href)}`
  return <img src={favicon} alt="" width={size} height={size} aria-hidden="true" />
}

function navigate(event: MouseEvent<HTMLAnchorElement>, source: SourceContextValue): void {
  if (!source.onNavigate) return
  event.preventDefault()
  source.onNavigate(source.href)
}
