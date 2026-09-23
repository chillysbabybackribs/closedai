import type { JSX } from 'react'
import { useEffect, useState, type PointerEvent } from 'react'
import { Trash2, X } from 'lucide-react'
import type { SavedSite } from '../shared/saved-sites.js'
import { BrowserSiteIcon } from './browser-site-icon.js'
import type { BrowserSavedSitesController } from './browser-saved-sites-controller.js'

// Floating workspace panel opened from View or the browser star.
// Each row is the record a daily brief will later read: the page, and an optional note saying
// why. The note is plain text until clicked, so a row without one stays quiet.

export function BrowserSavedSitesShelf({
  controller,
  onError,
  onOpenSite
}: {
  controller: BrowserSavedSitesController
  onError: (reason: unknown) => void
  onOpenSite: (url: string) => Promise<void>
}): JSX.Element {
  const [position, setPosition] = useState(() => ({
    x: Math.max(12, window.innerWidth - 408), y: 72
  }))
  const [size, setSize] = useState(() => ({ width: 380, height: Math.min(440, window.innerHeight - 96) }))
  const [drag, setDrag] = useState<{ x: number; y: number; left: number; top: number } | null>(null)
  const [resize, setResize] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const startDrag = (event: PointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ x: event.clientX, y: event.clientY, left: position.x, top: position.y })
  }
  const moveDrag = (event: PointerEvent<HTMLElement>): void => {
    if (!drag) return
    setPosition({
      x: Math.max(8, Math.min(window.innerWidth - size.width - 8, drag.left + event.clientX - drag.x)),
      y: Math.max(42, Math.min(window.innerHeight - 48, drag.top + event.clientY - drag.y))
    })
  }
  const resizeTo = (width: number, height: number): void => setSize({
    width: Math.max(280, Math.min(window.innerWidth - position.x - 8, width)),
    height: Math.max(180, Math.min(window.innerHeight - position.y - 8, height))
  })
  return (
    <section
      className="browser-saved-sites"
      style={{ left: position.x, top: position.y, width: size.width, height: size.height }}
      aria-label="Saved sites"
      role="dialog"
      aria-modal="false"
      data-ui-surface="browser-saved-sites"
      data-ui-source="src/renderer/browser-saved-sites-shelf.tsx#BrowserSavedSitesShelf" data-ui-state-owner="src/renderer/browser-saved-sites-controller.ts#useBrowserSavedSitesController"
    >
      <header className="browser-saved-sites-head" data-ui="saved-sites.move"
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => setDrag(null)}
        onLostPointerCapture={() => setDrag(null)}>
        <span className="browser-saved-sites-title">Saved sites{controller.sites.length ? ` · ${controller.sites.length}` : ''}</span>
        <button
          type="button"
          className="browser-saved-sites-close"
          aria-label="Hide saved sites"
          data-ui="saved-sites.hide"
          title="Hide saved sites"
          onClick={controller.dismiss}
        >
          <X size={12} />
        </button>
      </header>
      {controller.sites.length === 0 ? (
        <p className="browser-saved-sites-empty">Nothing saved yet. Press the star on a page to keep it here.</p>
      ) : (
        <ul className="browser-saved-sites-list">
          {controller.sites.map((site) => (
            <SavedSiteRow key={site.id} site={site} controller={controller} onError={onError} onOpenSite={onOpenSite} />
          ))}
        </ul>
      )}
      <button type="button" className="browser-saved-sites-resize" data-ui="saved-sites.resize"
        aria-label="Resize saved sites" title="Drag to resize saved sites"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          setResize({ x: event.clientX, y: event.clientY, ...size })
        }}
        onPointerMove={(event) => {
          if (resize) resizeTo(resize.width + event.clientX - resize.x, resize.height + event.clientY - resize.y)
        }}
        onPointerUp={() => setResize(null)} onLostPointerCapture={() => setResize(null)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 8 : 24
          if (event.key === 'ArrowRight') resizeTo(size.width + step, size.height)
          else if (event.key === 'ArrowLeft') resizeTo(size.width - step, size.height)
          else if (event.key === 'ArrowDown') resizeTo(size.width, size.height + step)
          else if (event.key === 'ArrowUp') resizeTo(size.width, size.height - step)
          else return
          event.preventDefault()
        }} />
    </section>
  )
}

function SavedSiteRow({
  site,
  controller,
  onError,
  onOpenSite
}: {
  site: SavedSite
  controller: BrowserSavedSitesController
  onError: (reason: unknown) => void
  onOpenSite: (url: string) => Promise<void>
}): JSX.Element {
  const label = site.title || hostOf(site.url)
  return (
    <li className="browser-saved-sites-row">
      <button
        type="button"
        className="browser-saved-sites-open"
        data-ui="saved-sites.open"
        data-ui-key={site.id}
        title={site.url}
        aria-label={`Open ${label}`}
        onClick={() => { void onOpenSite(site.url).catch(onError) }}
      >
        <BrowserSiteIcon favicon={site.favicon ?? undefined} />
        <span className="browser-saved-sites-text">
          <span className="browser-saved-sites-name">{label}</span>
          <span className="browser-saved-sites-host">{hostOf(site.url)}</span>
        </span>
      </button>
      <button
        type="button"
        className="browser-saved-sites-remove"
        data-ui="saved-sites.remove"
        data-ui-key={site.id}
        aria-label={`Remove ${label} from saved sites`}
        title="Remove"
        onClick={() => { void controller.remove(site.id).catch(onError) }}
      >
        <Trash2 size={12} />
      </button>
      <SavedSiteNote site={site} label={label} controller={controller} onError={onError} />
    </li>
  )
}

function SavedSiteNote({
  site,
  label,
  controller,
  onError
}: {
  site: SavedSite
  label: string
  controller: BrowserSavedSitesController
  onError: (reason: unknown) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(site.note)
  // A remote change (another pane, a later brief agent) wins over a stale draft only while the
  // field is not open.
  useEffect(() => { if (!editing) setDraft(site.note) }, [site.note, editing])
  if (!editing) {
    return (
      <button
        type="button"
        className={`browser-saved-sites-note-text ${site.note ? '' : 'is-empty'}`}
        data-ui="saved-sites.note-edit"
        data-ui-key={site.id}
        aria-label={site.note ? `Edit note for ${label}` : `Add note for ${label}`}
        title={site.note ? 'Edit note' : 'Add a note'}
        onClick={() => { setDraft(site.note); setEditing(true) }}
      >
        {site.note || 'Add note'}
      </button>
    )
  }
  const close = (): void => setEditing(false)
  const commit = (): void => {
    const next = draft.trim()
    if (next !== site.note) void controller.update(site.id, next).catch(onError)
    close()
  }
  return (
    <input
      autoFocus
      className="browser-saved-sites-note"
      data-ui="saved-sites.note"
      data-ui-key={site.id}
      value={draft}
      placeholder="Why keep this? What to watch for…"
      aria-label={`Note for ${label}`}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); commit() }
        if (event.key === 'Escape') { event.preventDefault(); setDraft(site.note); close() }
      }}
    />
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}
