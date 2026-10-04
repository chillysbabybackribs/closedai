import { useCallback, useRef } from 'react'
import { Link2, Volume2, X } from '../icons/index.js'
import type { VideoCompareState } from '../../shared/types.js'
import type { BrowserTabInfo } from '../../shared/types.js'
import { VideoPlayer, type VideoPlaybackEvent } from './video-player.js'

export function VideoCompareView({
  compare,
  tabs,
  active
}: {
  compare: VideoCompareState
  tabs: BrowserTabInfo[]
  active: boolean
}) {
  const syncing = useRef(false)
  const videoRefs = useRef(new Map<string, HTMLVideoElement>())

  const tabMeta = (id: string): { name: string; revision: number } => {
    const tab = tabs.find((item) => item.id === id)
    return { name: tab?.title ?? 'Video', revision: tab?.video?.revision ?? 0 }
  }

  const applySync = useCallback((source: VideoPlaybackEvent) => {
    if (!compare.syncPlay || syncing.current) return
    if (source.source === 'timeupdate') return
    syncing.current = true
    try {
      for (const id of compare.tabIds) {
        if (id === source.tabId) continue
        const node = videoRefs.current.get(id)
        if (!node) continue
        if (source.source === 'seek' || source.source === 'play' || source.source === 'pause') {
          node.currentTime = source.currentTime
        }
        if (source.playing) void node.play().catch(() => {})
        else node.pause()
      }
    } finally {
      syncing.current = false
    }
  }, [compare.syncPlay, compare.tabIds])

  const setAudio = (tabId: string): void => {
    void window.closedai.browser.videoCompare({ op: 'audio', tabId })
  }

  return (
    <section className="video-compare" hidden={!active} role="tabpanel" aria-label="Compare videos">
      <div className="video-compare-bar" role="toolbar" aria-label="Compare controls">
        <span className="video-compare-title">Compare</span>
        <button type="button" className="video-compare-sync" data-ui="video.compare-sync"
          aria-pressed={compare.syncPlay} title="Sync playback"
          onClick={() => { void window.closedai.browser.videoCompare({ op: 'sync', enabled: !compare.syncPlay }) }}>
          <Link2 size={14} /> Sync {compare.syncPlay ? 'on' : 'off'}
        </button>
        <button type="button" className="video-compare-exit" data-ui="video.compare-clear" title="Exit compare"
          onClick={() => { void window.closedai.browser.videoCompare({ op: 'clear' }) }}>
          <X size={14} /> Exit
        </button>
      </div>
      <div className="video-compare-grid">
        {compare.tabIds.map((id) => {
          const meta = tabMeta(id)
          const audioFocus = compare.audioTabId === id
          return (
            <div key={id} className={`video-compare-tile ${audioFocus ? 'has-audio' : ''}`}>
              <div className="video-compare-tile-head">
                <span className="video-compare-tile-name">{meta.name}</span>
                <button type="button" className="video-compare-audio" data-ui="video.compare-audio" data-ui-key={id}
                  aria-pressed={audioFocus} title="Audio from this video"
                  onClick={() => setAudio(id)}>
                  <Volume2 size={14} /> {audioFocus ? 'Audio' : 'Muted'}
                </button>
              </div>
              <VideoPlayer
                tabId={id}
                revision={meta.revision}
                active={active}
                compact
                showToolbar={false}
                audioAllowed={audioFocus}
                selected={audioFocus}
                label={meta.name}
                onSelect={() => setAudio(id)}
                onVideoRef={(node) => {
                  if (node) videoRefs.current.set(id, node)
                  else videoRefs.current.delete(id)
                }}
                onPlayback={(event) => {
                  applySync(event)
                }}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}
