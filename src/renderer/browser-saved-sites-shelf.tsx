import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { SavedSite } from '../shared/saved-sites.js'
import { BrowserSiteIcon } from './browser-site-icon.js'
import type { BrowserSavedSitesController } from './browser-saved-sites-controller.js'

// Floating panel anchored under the toolbar star, the same placement as the downloads popover.
// Each row is the record a daily brief will later read: the page, and the note saying why.

export function BrowserSavedSitesShelf({
  controller,
  onError
}: {
  controller: BrowserSavedSitesController
  onError: (reason: unknown) => void
}): JSX.Element {
  return (
    <section
      className="browser-saved-sites"
      aria-label="Saved sites"
      role="dialog"
      aria-modal="false"
      data-ui-surface="browser-saved-sites"
      data-ui-source="src/renderer/browser-saved-sites-shelf.tsx#BrowserSavedSitesShelf" data-ui-state-owner="src/renderer/browser-saved-sites-controller.ts#useBrowserSavedSitesController"
    >
      <header className="browser-saved-sites-head">
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
            <SavedSiteRow key={site.id} site={site} autoFocusNote={controller.focusId === site.id} controller={controller} onError={onError} />
          ))}
        </ul>
      )}
    </section>
  )
}

function SavedSiteRow({
  site,
  autoFocusNote,
  controller,
  onError
}: {
  site: SavedSite
  autoFocusNote: boolean
  controller: BrowserSavedSitesController
  onError: (reason: unknown) => void
}): JSX.Element {
  const [note, setNote] = useState(site.note)
  const noteRef = useRef<HTMLInputElement>(null)
  // A remote change (another pane, a later brief agent) wins over a stale draft only when the
  // field is not being typed in.
  useEffect(() => { if (document.activeElement !== noteRef.current) setNote(site.note) }, [site.note])
  useEffect(() => { if (autoFocusNote) noteRef.current?.focus() }, [autoFocusNote])
  const commit = (): void => { if (note.trim() !== site.note) void controller.update(site.id, note).catch(onError) }
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
        onClick={() => { void controller.open(site.url).catch(onError) }}
      >
        <BrowserSiteIcon favicon={site.favicon ?? undefined} />
        <span className="browser-saved-sites-text">
          <span className="browser-saved-sites-name">{label}</span>
          <span className="browser-saved-sites-host">{hostOf(site.url)}</span>
        </span>
      </button>
      <input
        ref={noteRef}
        className="browser-saved-sites-note"
        data-ui="saved-sites.note"
        data-ui-key={site.id}
        value={note}
        placeholder="Why keep this? What to watch for…"
        aria-label={`Note for ${label}`}
        spellCheck={false}
        onChange={(event) => setNote(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
          if (event.key === 'Escape') { event.preventDefault(); setNote(site.note); event.currentTarget.blur() }
        }}
      />
      <button
        type="button"
        className="browser-saved-sites-remove"
        data-ui="saved-sites.remove"
        data-ui-key={site.id}
        aria-label={`Remove ${label} from saved sites`}
        title="Remove"
        onClick={() => { void controller.remove(site.id).catch(onError) }}
      >
        <X size={12} />
      </button>
    </li>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}
