import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { SavedSite } from '../../shared/saved-sites.js'
import { BrowserSiteIcon } from '../browser-site-icon.js'
import { useSavedSitesList } from '../browser-saved-sites-controller.js'

export type SavedSitesPanelProps = {
  active: boolean
  onError: (reason: unknown) => void
  onOpenSite: (url: string) => Promise<void>
  update: (id: string, note: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Saved sites and brief check log in a workspace view tab (Developer → Saved sites). */
export function SavedSitesPanel({ active, onError, onOpenSite, update, remove }: SavedSitesPanelProps): JSX.Element {
  const sites = useSavedSitesList(active)
  return (
    <div className="saved-sites-panel">
      <header className="saved-sites-panel-header">
        <div>
          <h2 className="saved-sites-panel-title">Saved sites</h2>
          <p className="saved-sites-panel-description">
            {sites.length
              ? `${sites.length} kept on purpose · newest first · daily briefs write check times and summaries below`
              : 'Nothing saved yet. Press the star on a web page to keep it here.'}
          </p>
        </div>
      </header>
      {sites.length === 0 ? (
        <p className="saved-sites-panel-empty">Star a page in the browser toolbar to add it.</p>
      ) : (
        <ul className="saved-sites-panel-list">
          {sites.map((site) => (
            <SavedSiteRow key={site.id} site={site} onError={onError} onOpenSite={onOpenSite} update={update} remove={remove} />
          ))}
        </ul>
      )}
    </div>
  )
}

function SavedSiteRow({
  site,
  onError,
  onOpenSite,
  update,
  remove
}: {
  site: SavedSite
  onError: (reason: unknown) => void
  onOpenSite: (url: string) => Promise<void>
  update: (id: string, note: string) => Promise<void>
  remove: (id: string) => Promise<void>
}): JSX.Element {
  const label = site.title || hostOf(site.url)
  return (
    <li className="saved-sites-panel-row">
      <button
        type="button"
        className="saved-sites-panel-open"
        data-ui="saved-sites.open"
        data-ui-key={site.id}
        title={site.url}
        aria-label={`Open ${label}`}
        onClick={() => { void onOpenSite(site.url).catch(onError) }}
      >
        <BrowserSiteIcon favicon={site.favicon ?? undefined} />
        <span className="saved-sites-panel-text">
          <span className="saved-sites-panel-name">{label}</span>
          <span className="saved-sites-panel-host">{hostOf(site.url)}</span>
        </span>
      </button>
      <button
        type="button"
        className="saved-sites-panel-remove"
        data-ui="saved-sites.remove"
        data-ui-key={site.id}
        aria-label={`Remove ${label} from saved sites`}
        title="Remove"
        onClick={() => { void remove(site.id).catch(onError) }}
      >
        <Trash2 size={12} />
      </button>
      <SavedSiteNote site={site} label={label} update={update} onError={onError} />
      <SavedSiteLog site={site} />
    </li>
  )
}

function SavedSiteLog({ site }: { site: SavedSite }): JSX.Element {
  const checked = site.lastCheckedAt !== null
  const when = checked ? formatWhen(site.lastCheckedAt!) : null
  return (
    <div className="saved-sites-panel-log" data-ui="saved-sites.log" data-ui-key={site.id}>
      <span className="saved-sites-panel-log-label">{checked ? `Checked ${when}` : 'Not checked yet'}</span>
      {site.lastSummary ? (
        <p className="saved-sites-panel-log-summary">{site.lastSummary}</p>
      ) : checked ? (
        <p className="saved-sites-panel-log-summary is-empty">No summary recorded.</p>
      ) : null}
    </div>
  )
}

function SavedSiteNote({
  site,
  label,
  update,
  onError
}: {
  site: SavedSite
  label: string
  update: (id: string, note: string) => Promise<void>
  onError: (reason: unknown) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(site.note)
  useEffect(() => { if (!editing) setDraft(site.note) }, [site.note, editing])
  if (!editing) {
    return (
      <button
        type="button"
        className={`saved-sites-panel-note-text ${site.note ? '' : 'is-empty'}`}
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
    if (next !== site.note) void update(site.id, next).catch(onError)
    close()
  }
  return (
    <input
      autoFocus
      className="saved-sites-panel-note"
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

function formatWhen(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ms)
  } catch {
    return new Date(ms).toLocaleString()
  }
}
