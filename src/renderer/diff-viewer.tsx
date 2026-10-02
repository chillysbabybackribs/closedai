import type { JSX } from 'react'
import { memo, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Columns2, Copy, FileCode, Rows2 } from 'lucide-react'
import { useWorkspacePaneActions } from './chat-layout/workspace-pane-actions.js'

import {
  alignHunkLines,
  formatHunkRaw,
  highlightTokens,
  parseUnifiedDiff,
  type DiffLineKind,
  type ParsedDiff,
  type ParsedDiffLine,
  type ParsedHunk,
  type SplitDiffCell,
  type SplitDiffRow
} from './diff-parser.js'

export type {
  DiffLineKind,
  ParsedDiff,
  ParsedDiffLine,
  ParsedHunk,
  SplitDiffCell,
  SplitDiffRow
}

export { alignHunkLines, formatHunkRaw, highlightTokens, parseUnifiedDiff }

export type DiffViewMode = 'unified' | 'split'

export type DiffViewerProps = {
  path: string
  diff: string
  defaultViewMode?: DiffViewMode
  cwd?: string
}

export const DiffViewer = memo(function DiffViewer({
  path,
  diff,
  defaultViewMode = 'unified',
  cwd
}: DiffViewerProps): JSX.Element {
  const [copied, setCopied] = useState(false)
  const workspace = useWorkspacePaneActions()
  const [copiedHunk, setCopiedHunk] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<DiffViewMode>(defaultViewMode)
  const [collapsedHunks, setCollapsedHunks] = useState<Set<number>>(() => new Set())
  const parsed = useMemo(() => parseUnifiedDiff(diff), [diff])
  const splitHunks = useMemo(() => parsed.hunks.map((hunk) => alignHunkLines(hunk.lines)), [parsed.hunks])

  const headerHunks = useMemo(
    () => parsed.hunks.map((hunk, index) => ({ hunk, index })).filter((item) => Boolean(item.hunk.header)),
    [parsed.hunks]
  )
  const allCollapsed = headerHunks.length > 0 && headerHunks.every((item) => collapsedHunks.has(item.index))

  function toggleAllHunks(): void {
    if (allCollapsed) {
      setCollapsedHunks(new Set())
    } else {
      setCollapsedHunks(new Set(headerHunks.map((item) => item.index)))
    }
  }

  function toggleHunk(index: number): void {
    setCollapsedHunks((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function copyHunk(index: number, hunk: ParsedHunk): void {
    void navigator.clipboard.writeText(formatHunkRaw(hunk))
    setCopiedHunk(index)
    setTimeout(() => setCopiedHunk(null), 2000)
  }

  function copyDiff(): void {
    void navigator.clipboard.writeText(diff)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function openFile(): void {
    const options = { cwd, diff }
    void (workspace ? workspace.openFile(path, options) : window.closedai.localFiles.open(path, options)).catch(() => {})
  }

  const totalChanges = parsed.additions + parsed.deletions
  const addPercent = totalChanges > 0 ? (parsed.additions / totalChanges) * 100 : 0
  const delPercent = totalChanges > 0 ? (parsed.deletions / totalChanges) * 100 : 0

  return (
    <div className="activity-card-diff-container">
      <header className="diff-header">
        <div className="diff-header-title">
          <FileCode className="diff-header-icon" aria-hidden="true" />
          <button
            type="button"
            className="diff-header-path aui-md-local-file"
            data-ui="chat.local-file"
            data-ui-key={path}
            onClick={openFile}
            title={`Reveal ${path} in workspace`}
          >
            {path}
          </button>
        </div>
        <div className="diff-header-actions">
          {totalChanges > 0 && (
            <div className="diff-stat-summary">
              {parsed.additions > 0 && <span className="diff-stat-add">+{parsed.additions}</span>}
              {parsed.deletions > 0 && <span className="diff-stat-del">-{parsed.deletions}</span>}
              <div className="diff-stat-bar" title={`+${parsed.additions}, -${parsed.deletions}`}>
                <div className="diff-stat-bar-add" style={{ width: `${addPercent}%` }} />
                <div className="diff-stat-bar-del" style={{ width: `${delPercent}%` }} />
              </div>
            </div>
          )}
          {headerHunks.length > 1 && (
            <button
              type="button"
              className="diff-action-btn"
              data-ui="diff.collapse-all"
              onClick={toggleAllHunks}
              title={allCollapsed ? 'Expand all hunks' : 'Collapse all hunks'}
            >
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          )}
          <div className="diff-view-mode-toggle">
            <button
              type="button"
              className={`diff-mode-btn ${viewMode === 'unified' ? 'is-active' : ''}`}
              data-ui="diff.toggle-view"
              data-ui-key="unified"
              onClick={() => setViewMode('unified')}
              title="Unified diff view"
            >
              <Rows2 className="diff-btn-icon" aria-hidden="true" />
              <span>Unified</span>
            </button>
            <button
              type="button"
              className={`diff-mode-btn ${viewMode === 'split' ? 'is-active' : ''}`}
              data-ui="diff.toggle-view"
              data-ui-key="split"
              onClick={() => setViewMode('split')}
              title="Split (side-by-side) diff view"
            >
              <Columns2 className="diff-btn-icon" aria-hidden="true" />
              <span>Split</span>
            </button>
          </div>
          <button
            type="button"
            className="diff-copy-btn"
            onClick={copyDiff}
            title={copied ? 'Copied to clipboard' : 'Copy diff to clipboard'}
          >
            {copied ? <Check className="diff-btn-icon" aria-hidden="true" /> : <Copy className="diff-btn-icon" aria-hidden="true" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </header>

      {viewMode === 'unified' ? (
        <div className="diff-table" role="region" aria-label={`Unified diff for ${path}`}>
          {parsed.hunks.map((hunk, hunkIdx) => {
            const isCollapsed = collapsedHunks.has(hunkIdx)
            return (
              <div key={hunkIdx} className="diff-hunk-block">
                {hunk.header ? (
                  <div className="diff-row diff-row-hunk">
                    <button
                      type="button"
                      className="diff-hunk-toggle-btn"
                      data-ui="diff.collapse-hunk"
                      data-ui-key={String(hunkIdx)}
                      onClick={() => toggleHunk(hunkIdx)}
                      title={isCollapsed ? 'Expand hunk' : 'Collapse hunk'}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="diff-hunk-chevron" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="diff-hunk-chevron" aria-hidden="true" />
                      )}
                      <span className="diff-code diff-hunk-header">{hunk.header}</span>
                      {isCollapsed ? (
                        <span className="diff-hunk-collapsed-label">({hunk.lines.length} lines hidden)</span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="diff-hunk-copy-btn"
                      data-ui="diff.copy-hunk"
                      data-ui-key={String(hunkIdx)}
                      onClick={(e) => {
                        e.stopPropagation()
                        copyHunk(hunkIdx, hunk)
                      }}
                      title="Copy this hunk"
                    >
                      {copiedHunk === hunkIdx ? (
                        <Check className="diff-btn-icon" aria-hidden="true" />
                      ) : (
                        <Copy className="diff-btn-icon" aria-hidden="true" />
                      )}
                      <span>{copiedHunk === hunkIdx ? 'Copied' : 'Copy hunk'}</span>
                    </button>
                  </div>
                ) : null}
                {!isCollapsed && hunk.lines.map((line, lineIdx) => (
                  <div key={lineIdx} className={`diff-row diff-row-${line.kind}`}>
                    <span className="diff-gutter diff-gutter-old" aria-hidden="true">
                      {line.oldNum !== null ? line.oldNum : ''}
                    </span>
                    <span className="diff-gutter diff-gutter-new" aria-hidden="true">
                      {line.newNum !== null ? line.newNum : ''}
                    </span>
                    <span className="diff-gutter diff-gutter-sign" aria-hidden="true">
                      {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
                    </span>
                    <span className="diff-code">
                      {line.kind === 'meta' ? line.text : highlightTokens(line.text)}
                    </span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="diff-table diff-table-split" role="region" aria-label={`Split diff for ${path}`}>
          {splitHunks.map((rows, hunkIdx) => {
            const hunk = parsed.hunks[hunkIdx]!
            const isCollapsed = collapsedHunks.has(hunkIdx)
            return (
              <div key={hunkIdx} className="diff-hunk-block">
                {hunk.header ? (
                  <div className="diff-row diff-row-hunk">
                    <button
                      type="button"
                      className="diff-hunk-toggle-btn"
                      data-ui="diff.collapse-hunk"
                      data-ui-key={String(hunkIdx)}
                      onClick={() => toggleHunk(hunkIdx)}
                      title={isCollapsed ? 'Expand hunk' : 'Collapse hunk'}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="diff-hunk-chevron" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="diff-hunk-chevron" aria-hidden="true" />
                      )}
                      <span className="diff-code diff-hunk-header">{hunk.header}</span>
                      {isCollapsed ? (
                        <span className="diff-hunk-collapsed-label">({rows.length} lines hidden)</span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="diff-hunk-copy-btn"
                      data-ui="diff.copy-hunk"
                      data-ui-key={String(hunkIdx)}
                      onClick={(e) => {
                        e.stopPropagation()
                        copyHunk(hunkIdx, hunk)
                      }}
                      title="Copy this hunk"
                    >
                      {copiedHunk === hunkIdx ? (
                        <Check className="diff-btn-icon" aria-hidden="true" />
                      ) : (
                        <Copy className="diff-btn-icon" aria-hidden="true" />
                      )}
                      <span>{copiedHunk === hunkIdx ? 'Copied' : 'Copy hunk'}</span>
                    </button>
                  </div>
                ) : null}
                {!isCollapsed && rows.map((row, rowIdx) => (
                  <div key={rowIdx} className="diff-split-row">
                    <div className={`diff-split-pane diff-split-left diff-split-${row.left.kind}`}>
                      <span className="diff-gutter diff-gutter-old" aria-hidden="true">
                        {row.left.num ?? ''}
                      </span>
                      <span className="diff-gutter diff-gutter-sign" aria-hidden="true">
                        {row.left.kind === 'remove' ? '-' : ' '}
                      </span>
                      <span className="diff-code">
                        {row.left.kind === 'meta'
                          ? row.left.text
                          : row.left.kind !== 'empty'
                          ? highlightTokens(row.left.text)
                          : ''}
                      </span>
                    </div>
                    <div className={`diff-split-pane diff-split-right diff-split-${row.right.kind}`}>
                      <span className="diff-gutter diff-gutter-new" aria-hidden="true">
                        {row.right.num ?? ''}
                      </span>
                      <span className="diff-gutter diff-gutter-sign" aria-hidden="true">
                        {row.right.kind === 'add' ? '+' : ' '}
                      </span>
                      <span className="diff-code">
                        {row.right.kind === 'meta'
                          ? row.right.text
                          : row.right.kind !== 'empty'
                          ? highlightTokens(row.right.text)
                          : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})
