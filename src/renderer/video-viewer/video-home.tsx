import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, Film, FolderOpen, Play, Search, Upload } from '../icons/index.js'
import type { VideoLibraryEntry } from '../../shared/video-library.js'

function formatBytes(bytes: number): string {
  if (bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function VideoHome({ id, active }: { id: string; active: boolean }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<VideoLibraryEntry[]>([])
  const [recents, setRecents] = useState<VideoLibraryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const refreshRecents = useCallback(() => {
    void window.closedai.localFiles.videoRecents().then(setRecents).catch(() => {})
  }, [])

  useEffect(() => {
    if (!active) return
    refreshRecents()
  }, [active, refreshRecents])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      void window.closedai.localFiles.searchVideos(query)
        .then((entries) => { if (!cancelled) setResults(entries) })
        .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Search failed.') })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, query ? 200 : 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query, active])

  const openPath = async (path: string): Promise<void> => {
    setError('')
    try {
      const result = await window.closedai.localFiles.open(path, { literalPath: true })
      if (result.kind === 'video') refreshRecents()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open this video.')
    }
  }

  const pickFile = async (): Promise<void> => {
    setError('')
    try {
      const path = await window.closedai.localFiles.pickVideo()
      if (path) await openPath(path)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open the file picker.')
    }
  }

  const list = query.trim() ? results : results.length ? results : recents
  const heading = query.trim() ? 'Search results' : recents.length && !results.length ? 'Recently opened' : 'Available videos'

  return (
    <section className="video-home" hidden={!active} role="tabpanel" id={`video-home-${id}`}
      aria-labelledby={`browser-tab-${id}`}>
      <div className="video-home-appbar">
        <span className="video-home-brand"><Film size={18} aria-hidden="true" /> Video</span>
        <span className="video-home-appbar-divider" aria-hidden="true" />
        <span>Library</span>
        <span className="video-home-local">Local files</span>
      </div>
      <div className="video-home-inner">
        <header className="video-home-header">
          <div>
            <p className="video-home-eyebrow">YOUR COLLECTION</p>
            <h1 className="video-home-title">Your video library</h1>
            <p className="video-home-lead">Find a video. Settle in. Press play.</p>
          </div>
          <div className="video-home-open-group">
            <button type="button" className="video-home-open" data-ui="video.home-open"
              onClick={() => { void pickFile() }}>
              <Upload size={16} aria-hidden="true" /> Open video
              <ArrowUpRight size={15} aria-hidden="true" />
            </button>
            <span>Choose a file from your computer</span>
          </div>
        </header>
        <div className="video-home-toolbar">
          <div className="video-home-source"><FolderOpen size={15} aria-hidden="true" /> Downloads &amp; Videos</div>
          <label className="video-home-search">
            <Search size={16} aria-hidden="true" />
            <input type="search" aria-label="Search videos" data-ui="video.home-search" placeholder="Search your videos…" value={query}
              onChange={(event) => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />
          </label>
        </div>
        {error ? <p className="video-home-error" role="alert">{error}</p> : null}
        <div className="video-home-list" aria-busy={loading}>
          <div className="video-home-list-heading">
            <h2 className="video-home-list-title">{heading}</h2>
            <span className="video-home-count" role="status">{loading ? 'Searching…' : `${list.length} ${list.length === 1 ? 'video' : 'videos'}`}</span>
          </div>
          {!loading && list.length === 0 ? (
            <div className="video-home-empty">
              <Film size={32} strokeWidth={1.25} aria-hidden="true" />
              <h3>{query.trim() ? 'No matching videos' : 'Your next watch starts here'}</h3>
              <p>{query.trim() ? 'Try a different name, or open a file from your computer.' : 'Videos from Downloads and your Videos folder will appear here. Open a video to get started.'}</p>
            </div>
          ) : null}
          <ul className="video-home-rows">
            {list.map((entry) => (
              <li key={entry.path}>
                <button type="button" className="video-home-row" data-ui="video.home-open-item" data-ui-key={entry.path}
                  title={`Play ${entry.name}`} onClick={() => { void openPath(entry.path) }}>
                  <span className="video-home-row-preview" aria-hidden="true"><Play size={19} fill="currentColor" strokeWidth={1.5} /></span>
                  <span className="video-home-row-info">
                    <span className="video-home-row-name">{entry.name}</span>
                    <span className="video-home-row-path" title={entry.path}>{entry.path}</span>
                  </span>
                  <span className="video-home-row-meta">
                    <span className="video-home-row-format">{entry.name.split('.').pop()?.toUpperCase()}</span>
                    <span>{formatBytes(entry.bytes)}</span>
                  </span>
                  <span className="video-home-row-date">{formatWhen(entry.modifiedMs)}</span>
                  <ArrowUpRight className="video-home-row-arrow" size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <p className="video-home-footnote">Played directly from your computer. No upload needed.</p>
      </div>
    </section>
  )
}
