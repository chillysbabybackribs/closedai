import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, ChevronsDownUp, RefreshCw, X } from '../icons/index.js'
import type { FileTreeEntry, FileTreeListing } from '../../shared/file-tree.js'
import { FileIcon } from './file-icon.js'
import { expansionKey, readExpansion, saveTreeState } from './file-tree-state.js'

type Folder = { listing?: FileTreeListing; error?: string }
type Row = { entry: FileTreeEntry; depth: number; parent: string; position: number; size: number } | { message: string; depth: number; parent: string }
export function FileTreePanel({ root, active, onClose, onOpen }: {
  root: string; active: boolean; onClose: () => void; onOpen: (href: string) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(() => new Set(readExpansion(root)))
  const [folders, setFolders] = useState<Record<string, Folder>>({})
  const [selected, setSelected] = useState('')
  const [focus, setFocus] = useState('')
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const tree = useRef<HTMLDivElement>(null)
  useEffect(() => { saveTreeState(expansionKey(root), [...expanded]) }, [root, expanded])
  // Read visible expanded folders only. An abandoned request cannot paint a new project.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    let running = false
    const read = async () => {
      if (running) return
      running = true
      setLoading(true)
      const paths = ['', ...[...expanded].filter(path => {
        const parts = path.split('/'); parts.pop()
        while (parts.length) { if (!expanded.has(parts.join('/'))) return false; parts.pop() }
        return true
      })]
      const results: Record<string, Folder> = {}
      // Bound concurrency when restoring a large saved tree.
      let next = 0
      await Promise.all(Array.from({ length: Math.min(4, paths.length) }, async () => {
        while (next < paths.length && !cancelled) {
          const path = paths[next++]
          try { results[path] = { listing: await window.closedai.localFiles.listDirectory(root, path) } }
          catch (reason) { results[path] = { error: reason instanceof Error ? reason.message : 'Could not read this folder.' } }
        }
      }))
      if (!cancelled) {
        // The poll re-reads every 5 s; an unchanged listing keeps its object so the rows do not
        // re-render (a 5,000-entry folder otherwise hitches the UI, and any drag, on each tick).
        setFolders(previous => {
          const keys = Object.keys(results)
          const same = keys.length === Object.keys(previous).length && keys.every(key =>
            JSON.stringify(previous[key]) === JSON.stringify(results[key]))
          return same ? previous : results
        })
        setLoading(false)
      }
      running = false
    }
    void read()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void read() }, 5000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [root, expanded, active, refresh])
  const rows = useMemo(() => {
    const result: Row[] = []
    function visit(path: string, depth: number) {
      const folder = folders[path]
      if (!folder?.listing) { result.push({ message: folder?.error ?? 'Loading…', depth, parent: path }); return }
      if (!folder.listing.entries.length) result.push({ message: 'Empty folder', depth, parent: path })
      folder.listing.entries.forEach((entry, index) => {
        result.push({ entry, depth, parent: path, position: index + 1, size: folder.listing!.entries.length })
        if (entry.directory && expanded.has(entry.path)) visit(entry.path, depth + 1)
      })
      if (folder.listing.truncated) result.push({ message: 'Showing the first 5,000 entries.', depth, parent: path })
    }
    visit('', 0)
    return result
  }, [folders, expanded])
  const entries = rows.filter((row): row is Extract<Row, { entry: FileTreeEntry }> => 'entry' in row)
  const toggle = useCallback((path: string, open?: boolean) => setExpanded(previous => {
    const next = new Set(previous)
    if (open ?? !next.has(path)) next.add(path); else next.delete(path)
    return next
  }), [])
  const openFile = (entry: FileTreeEntry) => {
    setSelected(entry.path); setError('')
    const path = `${root.replace(/[\\/]$/, '')}/${entry.path}`
    void onOpen(path).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not open this file.'))
  }
  const moveFocus = (path: string) => {
    setFocus(path)
    const button = [...(tree.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? [])].find(item => item.dataset.path === path)
    button?.focus(); button?.scrollIntoView({ block: 'nearest' })
  }
  const keyboard = (event: KeyboardEvent, row: Extract<Row, { entry: FileTreeEntry }>) => {
    const index = entries.findIndex(item => item.entry.path === row.entry.path)
    let target: string | undefined
    if (event.key === 'ArrowDown') target = entries[Math.min(index + 1, entries.length - 1)]?.entry.path
    else if (event.key === 'ArrowUp') target = entries[Math.max(index - 1, 0)]?.entry.path
    else if (event.key === 'Home') target = entries[0]?.entry.path
    else if (event.key === 'End') target = entries.at(-1)?.entry.path
    else if (event.key === 'ArrowRight' && row.entry.directory) {
      if (!expanded.has(row.entry.path)) toggle(row.entry.path, true)
      else if (entries[index + 1]?.parent === row.entry.path) target = entries[index + 1].entry.path
    } else if (event.key === 'ArrowLeft') {
      if (row.entry.directory && expanded.has(row.entry.path)) toggle(row.entry.path, false)
      else target = row.parent
    } else return
    event.preventDefault()
    if (target) moveFocus(target)
  }
  const tabPath = entries.some(row => row.entry.path === focus) ? focus : entries[0]?.entry.path
  const name = root.replace(/[\\/]$/, '').split(/[\\/]/).pop() || root
  return <aside className="file-tree-panel" aria-label="Working directory files">
    <div className="file-tree-bar"><strong>Files</strong><div>
      <button data-ui="files.refresh" aria-label="Refresh files" title="Refresh files" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={13} className={loading ? 'file-tree-refreshing' : ''} /></button>
      <button data-ui="files.collapse" aria-label="Collapse all folders" title="Collapse all folders" onClick={() => setExpanded(new Set())}><ChevronsDownUp size={14} /></button>
      <button data-ui="files.close" aria-label="Hide files" title="Hide files" onClick={onClose}><X size={14} /></button>
    </div></div>
    <div className="file-tree-root" title={root}><ChevronDown size={12} /><strong>{name}</strong><small>{root}</small></div>
    <div ref={tree} role="tree" aria-label={root} className="file-tree-rows">
      {rows.map(row => 'entry' in row ? <button key={row.entry.path} role="treeitem"
        aria-level={row.depth + 1} aria-posinset={row.position} aria-setsize={row.size}
        aria-expanded={row.entry.directory ? expanded.has(row.entry.path) : undefined}
        aria-selected={selected === row.entry.path} tabIndex={tabPath === row.entry.path ? 0 : -1}
        className="file-tree-row" data-ui="files.entry" data-ui-key={row.entry.path} data-path={row.entry.path} style={{ paddingLeft: 12 + row.depth * 17 }}
        title={`${row.entry.path}${row.entry.symlink ? ' (symbolic link)' : ''}`}
        onFocus={() => setFocus(row.entry.path)} onKeyDown={event => keyboard(event, row)}
        onClick={() => row.entry.directory ? toggle(row.entry.path) : openFile(row.entry)}>
        <span className="file-tree-chevron">{row.entry.directory && (expanded.has(row.entry.path) ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}</span>
        <FileIcon name={row.entry.name} directory={row.entry.directory} /><span className="file-tree-name">{row.entry.name}</span>
        {row.entry.symlink && <span aria-label="Symbolic link">↗</span>}
      </button> : <div role="none" key={`status:${row.parent}`} className="file-tree-message" style={{ paddingLeft: 30 + row.depth * 17 }}>{row.message}</div>)}
    </div>
    {error && <div role="alert" className="file-tree-error">{error}</div>}
    <div className="file-tree-footer" title={root}>Working directory · {name}</div>
  </aside>
}
