import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Copy, FileCode, FolderOpen, Loader2 } from '../icons/index.js'
import { isRenderableFile, type FileTabContent } from '../../shared/local-files.js'
import { DiffViewer, highlightTokens } from '../diff-viewer.js'
import { LocalFileMarkdown } from '../local-file-markdown.js'
import { FileViewToggle } from './file-view-toggle.js'

/**
 * A local text file: the browser's source tab for an HTML or SVG page (`id` is its tab), or a file
 * view tab in the layout (`source: 'path'`, read by `path`).
 */
export function FileViewer({ id, source = 'tab', active, revision, line, endLine, diff, cwd, fileName, path }: {
  id: string
  source?: 'tab' | 'path'
  active: boolean
  revision: number
  line?: number
  endLine?: number
  diff?: string
  cwd?: string
  fileName?: string
  path?: string
}) {
  const [content, setContent] = useState<FileTabContent | null>(null)
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [copiedPath, setCopiedPath] = useState(false)
  const [copiedContent, setCopiedContent] = useState(false)
  const targetRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const showDiff = Boolean(diff)

  useEffect(() => {
    if (showDiff) {
      setLoading(false)
      setError('')
      setContent(null)
      return
    }
    let live = true
    setLoading(true)
    setError('')
    const load = source === 'path' && path ? window.closedai.localFiles.readPreview(path) : window.closedai.localFiles.file(id)
    load
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
  }, [id, source, path, revision, line, endLine, showDiff])

  useEffect(() => {
    if (active && targetRef.current) {
      targetRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [active, content?.line, loading])

  const lines = useMemo(() => {
    if (!content?.content) return []
    return content.content.split('\n')
  }, [content?.content])

  const markdownPreview = useMemo(() => {
    const name = content?.name ?? fileName ?? ''
    return /\.(md|markdown)$/i.test(name)
  }, [content?.name, fileName])

  function copyPath() {
    const path = content?.path
    if (!path) return
    void navigator.clipboard.writeText(path)
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
    const shown = source === 'path' && path ? window.closedai.localFiles.revealPath(path) : window.closedai.localFiles.revealFile(id)
    void shown.catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }

  const targetLine = content?.line ?? line
  const targetEndLine = content?.endLine ?? endLine
  const displayName = content?.name ?? fileName ?? 'Loading file…'
  const displayPath = content?.path ?? path

  return (
    <section
      className="file-viewer"
      hidden={!active}
      {...source === 'tab' ? { role: 'tabpanel', id: `file-page-${id}`, 'aria-labelledby': `browser-tab-${id}` } : {}}
    >
      <header className="file-viewer-toolbar" role="toolbar" aria-label="File controls">
        <FileCode className="file-viewer-icon" size={15} aria-hidden="true" />
        <span className="file-viewer-name" title={displayPath ?? displayName}>
          {displayName}
        </span>
        {showDiff ? (
          <span className="file-viewer-badge">Diff</span>
        ) : null}
        {!showDiff && lines.length > 0 && (
          <span className="file-viewer-meta">{lines.length} {lines.length === 1 ? 'line' : 'lines'}</span>
        )}
        {targetLine && !showDiff ? (
          <span className="file-viewer-badge">
            {targetEndLine ? `Lines ${targetLine}–${targetEndLine}` : `Line ${targetLine}`}
          </span>
        ) : null}
        <div className="file-viewer-actions">
          {!showDiff && (
            <button
              type="button"
              className="file-viewer-btn"
              onClick={copyPath}
              disabled={!displayPath}
              title={copiedPath ? 'Path copied!' : 'Copy path'}
              aria-label="Copy path"
              data-ui="file.copy-path"
            >
              {copiedPath ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              <span>{copiedPath ? 'Copied' : 'Path'}</span>
            </button>
          )}
          {!showDiff && (
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
          )}
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
          {/* Last, so Page | Code sits at the header's right end in both views (browser-pane.tsx). */}
          {source === 'tab' && !showDiff && isRenderableFile(displayPath ?? displayName) && (
            <FileViewToggle tabId={id} view="code"
              onError={(reason) => setError(reason instanceof Error ? reason.message : String(reason))} />
          )}
        </div>
      </header>

      <div ref={containerRef} className="file-viewer-body" tabIndex={0}>
        {loading && !showDiff && (
          <div className="file-viewer-loading">
            <Loader2 className="file-viewer-spinner" size={20} aria-hidden="true" />
            <span>Loading file content…</span>
          </div>
        )}

        {!loading && error && !showDiff && (
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

        {showDiff && diff && displayPath && (
          <div className="file-viewer-diff">
            <DiffViewer path={displayPath} diff={diff} defaultViewMode="unified" />
          </div>
        )}

        {!loading && !error && !showDiff && content && markdownPreview && (
          <div className="file-viewer-markdown">
            <LocalFileMarkdown cwd={cwd ?? content.cwd}>{content.content}</LocalFileMarkdown>
          </div>
        )}

        {!loading && !error && !showDiff && content && !markdownPreview && (
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
