import type { JSX, ReactNode } from 'react'
import { memo, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Columns2, Copy, FileCode, Rows2 } from 'lucide-react'

export type DiffLineKind = 'meta' | 'hunk' | 'add' | 'remove' | 'context'

export type ParsedDiffLine = {
  kind: DiffLineKind
  oldNum: number | null
  newNum: number | null
  text: string
  raw: string
}

export type ParsedHunk = {
  header: string
  lines: ParsedDiffLine[]
}

export type ParsedDiff = {
  hunks: ParsedHunk[]
  additions: number
  deletions: number
}

export type SplitDiffCell = {
  num: number | null
  text: string
  kind: 'context' | 'add' | 'remove' | 'meta' | 'empty'
}

export type SplitDiffRow = {
  left: SplitDiffCell
  right: SplitDiffCell
}

export type DiffViewMode = 'unified' | 'split'

export type DiffViewerProps = {
  path: string
  diff: string
  defaultViewMode?: DiffViewMode
}

const HUNK_REGEX = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)?$/
const TOKEN_REGEX = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:import|export|from|const|let|var|function|return|if|else|for|while|async|await|class|interface|type|extends|implements|try|catch|finally|throw|new|default|typeof|instanceof|switch|case|break|def|self|None|True|False|elif)\b|\b(?:true|false|null|undefined|void|boolean|number|string|any)\b|\b\d+(?:\.\d+)?\b|\b[A-Z][a-zA-Z0-9_$]*\b)/g

export function parseUnifiedDiff(rawDiff: string): ParsedDiff {
  const lines = rawDiff.split('\n')
  const hunks: ParsedHunk[] = []
  let currentHunk: ParsedHunk | null = null
  let oldLine = 1
  let newLine = 1
  let additions = 0
  let deletions = 0

  for (const line of lines) {
    const hunkMatch = line.match(HUNK_REGEX)
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1]!, 10)
      newLine = parseInt(hunkMatch[3]!, 10)
      currentHunk = { header: line, lines: [] }
      hunks.push(currentHunk)
      continue
    }

    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('\\')) {
      const metaLine: ParsedDiffLine = { kind: 'meta', oldNum: null, newNum: null, text: line, raw: line }
      if (!currentHunk) {
        currentHunk = { header: '', lines: [] }
        hunks.push(currentHunk)
      }
      currentHunk.lines.push(metaLine)
      continue
    }

    if (!currentHunk) {
      currentHunk = { header: '', lines: [] }
      hunks.push(currentHunk)
    }

    if (line.startsWith('+')) {
      additions++
      currentHunk.lines.push({
        kind: 'add',
        oldNum: null,
        newNum: newLine++,
        text: line.slice(1),
        raw: line
      })
    } else if (line.startsWith('-')) {
      deletions++
      currentHunk.lines.push({
        kind: 'remove',
        oldNum: oldLine++,
        newNum: null,
        text: line.slice(1),
        raw: line
      })
    } else {
      const text = line.startsWith(' ') ? line.slice(1) : line
      currentHunk.lines.push({
        kind: 'context',
        oldNum: oldLine++,
        newNum: newLine++,
        text,
        raw: line
      })
    }
  }

  return { hunks, additions, deletions }
}

export function alignHunkLines(lines: ParsedDiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  let pendingRemoves: ParsedDiffLine[] = []
  let pendingAdds: ParsedDiffLine[] = []

  function flush(): void {
    const count = Math.max(pendingRemoves.length, pendingAdds.length)
    for (let i = 0; i < count; i++) {
      const rem = pendingRemoves[i]
      const add = pendingAdds[i]
      rows.push({
        left: rem
          ? { num: rem.oldNum, text: rem.text, kind: 'remove' }
          : { num: null, text: '', kind: 'empty' },
        right: add
          ? { num: add.newNum, text: add.text, kind: 'add' }
          : { num: null, text: '', kind: 'empty' }
      })
    }
    pendingRemoves = []
    pendingAdds = []
  }

  for (const line of lines) {
    if (line.kind === 'remove') {
      pendingRemoves.push(line)
    } else if (line.kind === 'add') {
      pendingAdds.push(line)
    } else {
      flush()
      if (line.kind === 'meta') {
        rows.push({
          left: { num: null, text: line.text, kind: 'meta' },
          right: { num: null, text: line.text, kind: 'meta' }
        })
      } else {
        rows.push({
          left: { num: line.oldNum, text: line.text, kind: 'context' },
          right: { num: line.newNum, text: line.text, kind: 'context' }
        })
      }
    }
  }
  flush()
  return rows
}

export function formatHunkRaw(hunk: ParsedHunk): string {
  const lines: string[] = []
  if (hunk.header) lines.push(hunk.header)
  for (const line of hunk.lines) {
    lines.push(line.raw)
  }
  return lines.join('\n')
}

export function highlightTokens(code: string): ReactNode[] {
  if (!code) return [' ']
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  TOKEN_REGEX.lastIndex = 0
  while ((match = TOKEN_REGEX.exec(code)) !== null) {
    if (match.index > lastIndex) {
      parts.push(code.slice(lastIndex, match.index))
    }
    const token = match[0]
    let tokenClass = ''
    if (token.startsWith('//') || token.startsWith('/*') || token.startsWith('#')) {
      tokenClass = 'diff-token-comment'
    } else if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
      tokenClass = 'diff-token-string'
    } else if (/^(?:import|export|from|const|let|var|function|return|if|else|for|while|async|await|class|interface|type|extends|implements|try|catch|finally|throw|new|default|typeof|instanceof|switch|case|break|def|self|elif)$/.test(token)) {
      tokenClass = 'diff-token-keyword'
    } else if (/^(?:true|false|null|undefined|void|boolean|number|string|any|None|True|False)$/.test(token)) {
      tokenClass = 'diff-token-literal'
    } else if (/^\d+(?:\.\d+)?$/.test(token)) {
      tokenClass = 'diff-token-number'
    } else if (/^[A-Z]/.test(token)) {
      tokenClass = 'diff-token-type'
    }
    parts.push(<span key={match.index} className={tokenClass}>{token}</span>)
    lastIndex = match.index + token.length
  }

  if (lastIndex < code.length) {
    parts.push(code.slice(lastIndex))
  }
  return parts
}

export const DiffViewer = memo(function DiffViewer({
  path,
  diff,
  defaultViewMode = 'unified'
}: DiffViewerProps): JSX.Element {
  const [copied, setCopied] = useState(false)
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
    const href = path.startsWith('file://') ? path : `file://${path.startsWith('/') ? '' : '/'}${path}`
    void window.closedai.localFiles.open(href)
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
            className="diff-header-path"
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
