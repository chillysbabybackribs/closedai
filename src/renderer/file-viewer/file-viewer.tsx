import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Copy, FileCode, FolderOpen, Loader2 } from 'lucide-react'
import type { FileTabContent } from '../../shared/local-files.js'
import { highlightTokens } from '../diff-viewer.js'

export function FileViewer({ id, active }: { id: string; active: boolean }) {
  const [content, setContent] = useState<FileTabContent | null>(null)
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [copiedPath, setCopiedPath] = useState(false)
  const [copiedContent, setCopiedContent] = useState(false)
  const targetRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    window.closedai.localFiles.file(id)
      .then((data) => {
        if (live) {
          setContent(data)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (live) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => { live = false }
  }, [id])

  useEffect(() => {
    if (active && targetRef.current) {
      targetRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [active, content?.line, loading])

  const lines = useMemo(() => {
    if (!content?.content) return []
    return content.content.split('\n')
  }, [content?.content])

  function copyPath() {
    if (!content?.path) return
    void navigator.clipboard.writeText(content.path)
    setCopiedPath(true)
    setTimeout(() => setCopiedPath(false), 2000)
  }

  function copyCode() {
    if (!content?.content) return
    void navigator.clipboard.writeText(content.content)
    setCopiedContent(true)
    setTimeout(() => setCopiedContent(false), 2000)
  }

  function reveal() {
    void window.closedai.localFiles.revealFile(id).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }

  const targetLine = content?.line
  const targetEndLine = content?.endLine

  return (
    <section
      className="file-viewer"
      hidden={!active}
      role="tabpanel"
      id={`file-page-${id}`}
      aria-labelledby={`browser-tab-${id}`}
    >
      <header className="file-viewer-toolbar" role="toolbar" aria-label="File controls">
        <FileCode className="file-viewer-icon" size={15} aria-hidden="true" />
        <span className="file-viewer-name" title={content?.path ?? 'Loading file…'}>
          {content?.name ?? 'Loading file…'}
        </span>
        {lines.length > 0 && (
          <span className="file-viewer-meta">{lines.length} {lines.length === 1 ? 'line' : 'lines'}</span>
        )}
        {targetLine && (
          <span className="file-viewer-badge">
            {targetEndLine ? `Lines ${targetLine}–${targetEndLine}` : `Line ${targetLine}`}
          </span>
        )}
        <div className="file-viewer-actions">
          <button
            type="button"
            className="file-viewer-btn"
            onClick={copyPath}
            title={copiedPath ? 'Path copied!' : 'Copy path'}
            aria-label="Copy path"
            data-ui="file.copy-path"
          >
            {copiedPath ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            <span>{copiedPath ? 'Copied' : 'Path'}</span>
          </button>
          <button
            type="button"
            className="file-viewer-btn"
            onClick={copyCode}
            disabled={!content?.content}
            title={copiedContent ? 'Content copied!' : 'Copy content'}
            aria-label="Copy content"
            data-ui="file.copy-content"
          >
            {copiedContent ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            <span>{copiedContent ? 'Copied' : 'Copy'}</span>
          </button>
          <button
            type="button"
            className="file-viewer-btn"
            onClick={reveal}
            title="Show in folder"
            aria-label="Show in folder"
            data-ui="file.reveal"
          >
            <FolderOpen size={14} aria-hidden="true" />
            <span>Folder</span>
          </button>
        </div>
      </header>

      <div ref={containerRef} className="file-viewer-body" tabIndex={0}>
        {loading && (
          <div className="file-viewer-loading">
            <Loader2 className="file-viewer-spinner" size={20} aria-hidden="true" />
            <span>Loading file content…</span>
          </div>
        )}

        {!loading && error && (
          <div className="file-viewer-error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <div className="file-viewer-error-text">
              <strong>Could not display file</strong>
              <p>{error}</p>
            </div>
            <button type="button" className="file-viewer-error-btn" onClick={reveal}>
              <FolderOpen size={14} aria-hidden="true" />
              <span>Show in Folder</span>
            </button>
          </div>
        )}

        {!loading && !error && content && (
          <div className="file-viewer-code-table">
            {lines.map((lineText, idx) => {
              const lineNum = idx + 1
              const isTarget =
                targetLine !== undefined &&
                (targetEndLine !== undefined
                  ? lineNum >= targetLine && lineNum <= targetEndLine
                  : lineNum === targetLine)
              return (
                <div
                  key={lineNum}
                  ref={lineNum === targetLine ? targetRef : undefined}
                  className={`file-viewer-row ${isTarget ? 'is-target' : ''}`}
                >
                  <span className="file-viewer-gutter" aria-hidden="true">
                    {lineNum}
                  </span>
                  <span className="file-viewer-code">
                    {highlightTokens(lineText)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
