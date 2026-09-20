import { useEffect, useRef, useState } from 'react'
import { Download, FolderOpen, Minus, Plus, Scan } from 'lucide-react'
import type { ImageTabContent } from '../../shared/local-files.js'

export function ImageViewer({ id, active }: { id: string; active: boolean }) {
  const [content, setContent] = useState<ImageTabContent | null>(null)
  const [error, setError] = useState('')
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState<number | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const fit = size.width && size.height
    ? Math.min(1, Math.max(1, viewport.width - 48) / size.width, Math.max(1, viewport.height - 48) / size.height) : 1
  const scale = zoom ?? fit

  useEffect(() => {
    let live = true
    void window.closedai.localFiles.image(id).then((image) => {
      if (live) setContent(image)
    }).catch((cause: unknown) => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [id])

  useEffect(() => {
    const node = stage.current
    if (!node || !active) return
    const measure = () => setViewport({ width: node.clientWidth, height: node.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [active])

  function changeZoom(next: number | null) {
    const node = stage.current
    const centerX = node ? (node.scrollLeft + node.clientWidth / 2) / scale : 0
    const centerY = node ? (node.scrollTop + node.clientHeight / 2) / scale : 0
    const value = next === null ? null : Math.max(0.05, Math.min(8, next))
    setZoom(value)
    requestAnimationFrame(() => {
      if (!node) return
      node.scrollLeft = value === null ? 0 : centerX * value - node.clientWidth / 2
      node.scrollTop = value === null ? 0 : centerY * value - node.clientHeight / 2
    })
  }

  return <section className="image-viewer" hidden={!active} role="tabpanel"
    id={`image-page-${id}`} aria-labelledby={`browser-tab-${id}`}>
    <div className="image-viewer-toolbar" role="toolbar" aria-label="Image controls">
      <span className="image-viewer-name" title={content?.path ?? content?.name}>{content?.name ?? 'Loading image…'}</span>
      <button type="button" data-ui="image.zoom-out" aria-label="Zoom out" title="Zoom out (−)"
        disabled={!size.width || scale <= 0.05} onClick={() => changeZoom(scale / 1.25)}><Minus size={16} /></button>
      <output className="image-viewer-scale" aria-label="Zoom">{Math.round(scale * 100)}%</output>
      <button type="button" data-ui="image.zoom-in" aria-label="Zoom in" title="Zoom in (+)"
        disabled={!size.width || scale >= 8} onClick={() => changeZoom(scale * 1.25)}><Plus size={16} /></button>
      <button type="button" data-ui="image.fit" aria-label="Fit image to pane" title="Fit to pane (0)"
        aria-pressed={zoom === null} onClick={() => changeZoom(null)}><Scan size={16} /></button>
      <button type="button" data-ui="image.actual-size" title="Actual size (1)"
        aria-label="Actual size" aria-pressed={zoom === 1} onClick={() => changeZoom(1)}>1:1</button>
      {content?.src.startsWith('data:') && <a data-ui="image.download" href={content.src} download={content.name}
        aria-label="Download image" title="Download image"><Download size={16} /></a>}
      {content?.path && <button type="button" data-ui="image.reveal" title="Show in folder" aria-label="Show in folder"
        onClick={() => { void window.closedai.localFiles.revealImage(id).catch((cause: unknown) => setError(String(cause))) }}>
        <FolderOpen size={16} /></button>}
    </div>
    <div ref={stage} className="image-viewer-stage" tabIndex={0} data-ui="image.canvas"
      aria-label="Image. Drag to pan; use plus or minus to zoom, 0 to fit, 1 for actual size."
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return
        if (!['+', '=', '-', '0', '1'].includes(event.key)) return
        event.preventDefault()
        changeZoom(event.key === '0' ? null : event.key === '1' ? 1 : scale * (event.key === '-' ? 0.8 : 1.25))
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const node = event.currentTarget
        drag.current = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop }
        node.setPointerCapture(event.pointerId)
        node.focus()
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        event.currentTarget.scrollLeft = drag.current.left - event.clientX + drag.current.x
        event.currentTarget.scrollTop = drag.current.top - event.clientY + drag.current.y
      }}
      onPointerUp={(event) => {
        drag.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
      {error ? <p className="image-viewer-error" role="alert">{error}</p> : content ?
        <div className="image-viewer-sheet" style={{ minWidth: size.width * scale + 48, minHeight: size.height * scale + 48 }}>
          <img src={content.src} alt={content.name} draggable={false}
            style={size.width ? { width: size.width * scale, height: size.height * scale } : { visibility: 'hidden' }}
            onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            onError={() => setError('This image could not be displayed.')} />
        </div> : <p className="image-viewer-error" role="status">Loading image…</p>}
    </div>
    <div className="image-viewer-status">{size.width ? `${size.width} × ${size.height} · Drag to pan` : 'Image preview'}</div>
  </section>
}
