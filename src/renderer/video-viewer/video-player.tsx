import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FolderOpen, Maximize, Pause, Play, Repeat, SkipBack, SkipForward, Volume2, VolumeX
} from '../icons/index.js'
import type { VideoTabContent } from '../../shared/local-files.js'
import { errorMessage } from '../error-message.js'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
const FS_HIDE_MS = 2800

export type VideoPlaybackEvent = {
  tabId: string
  playing: boolean
  currentTime: number
  source: 'play' | 'pause' | 'seek' | 'timeupdate'
}

function formatVideoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function VideoPlayer({
  tabId,
  revision,
  active,
  compact = false,
  showToolbar = true,
  audioAllowed = true,
  onPlayback,
  onSelect,
  onVideoRef,
  selected = false,
  label
}: {
  tabId: string
  revision: number
  active: boolean
  compact?: boolean
  showToolbar?: boolean
  /** When false the element stays muted regardless of the mute control (compare tiles). */
  audioAllowed?: boolean
  onPlayback?: (event: VideoPlaybackEvent) => void
  onSelect?: () => void
  onVideoRef?: (node: HTMLVideoElement | null) => void
  selected?: boolean
  label?: string
}) {
  const [content, setContent] = useState<VideoTabContent | null>(null)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [rate, setRate] = useState(1)
  const [loop, setLoop] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const [seeking, setSeeking] = useState(false)
  const [fsControls, setFsControls] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const fsTimer = useRef<number | null>(null)

  useEffect(() => {
    let live = true
    void window.closedai.localFiles.video(tabId).then((video) => {
      if (live) setContent(video)
    }).catch((cause: unknown) => {
      if (live) setError(errorMessage(cause, 'This video could not be opened.'))
    })
    return () => { live = false }
  }, [tabId, revision])

  useEffect(() => {
    const node = videoRef.current
    if (!node) return
    node.playbackRate = rate
    node.loop = loop
    node.muted = !audioAllowed || muted
    node.volume = volume
  }, [rate, loop, muted, volume, audioAllowed, content?.src])

  useEffect(() => {
    if (!active) videoRef.current?.pause()
  }, [active])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onFsChange = (): void => {
      setIsFullscreen(document.fullscreenElement === stage)
      setFsControls(true)
      bumpFsControls()
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const bumpFsControls = useCallback(() => {
    setFsControls(true)
    if (fsTimer.current) window.clearTimeout(fsTimer.current)
    if (document.fullscreenElement === stageRef.current) {
      fsTimer.current = window.setTimeout(() => setFsControls(false), FS_HIDE_MS)
    }
  }, [])

  const notify = useCallback((source: VideoPlaybackEvent['source'], playingNow: boolean, time: number) => {
    onPlayback?.({ tabId, playing: playingNow, currentTime: time, source })
  }, [onPlayback, tabId])

  const togglePlay = useCallback(() => {
    const node = videoRef.current
    if (!node) return
    if (node.paused) {
      void node.play().then(() => notify('play', true, node.currentTime)).catch(() => setError('Playback failed.'))
    } else {
      node.pause()
      notify('pause', false, node.currentTime)
    }
  }, [notify])

  const seekBy = useCallback((delta: number) => {
    const node = videoRef.current
    if (!node || !Number.isFinite(node.duration)) return
    node.currentTime = Math.max(0, Math.min(node.duration, node.currentTime + delta))
    notify('seek', !node.paused, node.currentTime)
  }, [notify])

  const toggleFullscreen = useCallback(() => {
    const target = stageRef.current
    if (!target) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void target.requestFullscreen().catch(() => {})
  }, [])

  const statusLine = dimensions && duration
    ? `${dimensions.width}×${dimensions.height} · ${formatVideoTime(duration)}${content?.bytes ? ` · ${formatBytes(content.bytes)}` : ''}`
    : content?.bytes ? formatBytes(content.bytes) : 'Video preview'

  return (
    <div className={`video-player ${compact ? 'is-compact' : ''} ${selected ? 'is-selected' : ''}`}
      onPointerDown={onSelect}>
      {showToolbar && !compact && (
        <div className="video-viewer-toolbar" role="toolbar" aria-label="Video controls">
          <span className="video-viewer-name" title={content?.path ?? label}>{label ?? content?.name ?? 'Loading video…'}</span>
          {content?.path && (
            <button type="button" data-ui="video.reveal" title="Show in folder" aria-label="Show in folder"
              onClick={() => { void window.closedai.localFiles.revealVideo(tabId).catch((cause: unknown) => setError(errorMessage(cause))) }}>
              <FolderOpen size={16} />
            </button>
          )}
          <button type="button" data-ui="video.fullscreen" title="Fullscreen (f)" aria-label="Fullscreen"
            onClick={toggleFullscreen}><Maximize size={16} /></button>
        </div>
      )}
      {compact && label && <div className="video-player-compact-label">{label}</div>}
      <div ref={stageRef} className={`video-viewer-stage ${isFullscreen && !fsControls ? 'fs-controls-hidden' : ''}`}
        tabIndex={compact ? -1 : 0} data-ui="video.stage"
        aria-label={label ?? 'Video'}
        onMouseMove={bumpFsControls}
        onKeyDown={compact ? undefined : (event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return
          if (event.key === ' ') { event.preventDefault(); togglePlay(); return }
          if (event.key === 'f') { event.preventDefault(); toggleFullscreen(); return }
          if (event.key === 'm') { event.preventDefault(); setMuted((value) => !value); return }
          if (event.key === 'ArrowLeft') { event.preventDefault(); seekBy(event.shiftKey ? -10 : -5); return }
          if (event.key === 'ArrowRight') { event.preventDefault(); seekBy(event.shiftKey ? 10 : 5); return }
          if (event.key === 'ArrowUp') { event.preventDefault(); setVolume((v) => Math.min(1, v + 0.05)); return }
          if (event.key === 'ArrowDown') { event.preventDefault(); setVolume((v) => Math.max(0, v - 0.05)); return }
        }}>
        {error ? <p className="video-viewer-error" role="alert">{error}</p> : content ? (
          <video ref={(node) => {
            videoRef.current = node
            onVideoRef?.(node)
          }} className="video-viewer-media" src={content.src} playsInline preload="metadata"
            onClick={() => { onSelect?.(); togglePlay() }}
            onPlay={() => { setPlaying(true); notify('play', true, videoRef.current?.currentTime ?? 0) }}
            onPause={() => { setPlaying(false); notify('pause', false, videoRef.current?.currentTime ?? 0) }}
            onTimeUpdate={(event) => {
              if (!seeking) setCurrent(event.currentTarget.currentTime)
              if (!seeking && event.currentTarget === videoRef.current) {
                notify('timeupdate', !event.currentTarget.paused, event.currentTarget.currentTime)
              }
            }}
            onLoadedMetadata={(event) => {
              setDuration(event.currentTarget.duration)
              setDimensions({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })
            }}
            onError={() => setError('This video could not be decoded. Try opening it in your system player.')} />
        ) : <p className="video-viewer-error" role="status">Loading video…</p>}
        {!compact && isFullscreen && (
          <div className={`video-player-fs-controls ${fsControls ? 'is-visible' : ''}`} role="group" aria-label="Fullscreen playback">
            <button type="button" data-ui="video.play" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
              {playing ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <output className="video-viewer-time">{formatVideoTime(current)} / {formatVideoTime(duration)}</output>
          </div>
        )}
      </div>
      <div className={`video-viewer-controls ${compact ? 'is-compact' : ''}`} role="group" aria-label="Playback">
        <button type="button" data-ui="video.skip-back" aria-label="Back 10 seconds" title="Back 10 seconds"
          disabled={!content} onClick={() => seekBy(-10)}><SkipBack size={16} /></button>
        <button type="button" data-ui="video.play" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (space)' : 'Play (space)'}
          disabled={!content} onClick={togglePlay}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button type="button" data-ui="video.skip-forward" aria-label="Forward 10 seconds" title="Forward 10 seconds"
          disabled={!content} onClick={() => seekBy(10)}><SkipForward size={16} /></button>
        <label className="video-viewer-seek">
          <input type="range" min={0} max={duration || 0} step={0.05} value={Math.min(current, duration || 0)}
            aria-label="Seek" disabled={!content || !duration}
            onChange={(event) => {
              const value = Number(event.target.value)
              setSeeking(true)
              setCurrent(value)
              if (videoRef.current) videoRef.current.currentTime = value
            }}
            onMouseUp={() => {
              setSeeking(false)
              if (videoRef.current) notify('seek', !videoRef.current.paused, videoRef.current.currentTime)
            }}
            onTouchEnd={() => {
              setSeeking(false)
              if (videoRef.current) notify('seek', !videoRef.current.paused, videoRef.current.currentTime)
            }} />
        </label>
        <output className="video-viewer-time" aria-live="off">{formatVideoTime(current)} / {formatVideoTime(duration)}</output>
        {!compact && (
          <>
            <button type="button" data-ui="video.mute" aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted}
              disabled={!content || !audioAllowed} onClick={() => setMuted((value) => !value)}>
              {muted || volume === 0 || !audioAllowed ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <label className="video-viewer-volume">
              <input type="range" min={0} max={1} step={0.02} value={muted ? 0 : volume} aria-label="Volume" disabled={!content || !audioAllowed}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setVolume(value)
                  setMuted(value === 0)
                }} />
            </label>
          </>
        )}
        <label className="video-viewer-speed">
          <select value={rate} disabled={!content} aria-label="Playback speed"
            onChange={(event) => setRate(Number(event.target.value))}>
            {SPEEDS.map((speed) => (
              <option key={speed} value={speed}>{speed === 1 ? '1×' : `${speed}×`}</option>
            ))}
          </select>
        </label>
        {!compact && (
          <button type="button" data-ui="video.loop" aria-label="Loop" aria-pressed={loop} title="Loop"
            disabled={!content} onClick={() => setLoop((value) => !value)}>
            <Repeat size={16} />
          </button>
        )}
      </div>
      {!compact && <div className="video-viewer-status">{statusLine}</div>}
    </div>
  )
}
