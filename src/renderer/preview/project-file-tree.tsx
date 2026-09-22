import { useState } from 'react'
import { ChevronDown, ChevronRight, FileText, FolderClosed, FolderOpen } from 'lucide-react'

import type { ProjectFile, ProjectFolder } from './project-files.js'
import { absolute } from './project-time.js'

export function ProjectFileTree(props: {
  root: ProjectFolder
  openPath: string | null
  changed: ReadonlySet<string>
  now: number
  onOpen: (path: string) => void
}) {
  const { root, openPath, changed, now, onOpen } = props
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const toggle = (path: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(path)) next.delete(path); else next.add(path)
    return next
  })
  const folderChanged = (folder: ProjectFolder): boolean =>
    folder.files.some((file) => changed.has(file.path)) || folder.folders.some(folderChanged)

  const renderFile = (file: ProjectFile, depth: number) =>
    <li key={file.path}>
      <button type="button" className="project-file" style={{ paddingLeft: 10 + depth * 14 }}
        data-ui="preview.project-file" data-ui-key={file.path}
        data-open={openPath === file.path || undefined} data-changed={changed.has(file.path) || undefined}
        data-owner={file.owner} data-root={depth === 0 || undefined} title={`${file.path} · ${absolute(file.updatedAt, now)}`}
        onClick={() => onOpen(file.path)}>
        <FileText size={12} aria-hidden="true" />
        <span>{file.title}</span>
      </button>
    </li>

  const renderFolder = (folder: ProjectFolder, depth: number) => {
    const isCollapsed = collapsed.has(folder.path)
    return <li key={folder.path}>
      <button type="button" className="project-folder" style={{ paddingLeft: 10 + depth * 14 }}
        data-ui="preview.project-folder" data-ui-key={folder.path}
        data-changed={(isCollapsed && folderChanged(folder)) || undefined}
        aria-expanded={!isCollapsed} onClick={() => toggle(folder.path)}>
        {isCollapsed ? <ChevronRight size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}
        {isCollapsed ? <FolderClosed size={12} aria-hidden="true" /> : <FolderOpen size={12} aria-hidden="true" />}
        <span>{folder.name}</span>
      </button>
      {!isCollapsed && <ul>
        {folder.folders.map((child) => renderFolder(child, depth + 1))}
        {folder.files.map((file) => renderFile(file, depth + 1))}
      </ul>}
    </li>
  }

  return <nav className="project-file-tree" aria-label="Project files">
    <header>
      <strong>Project</strong>
      <span>{countFiles(root)} files</span>
    </header>
    <ul>
      {root.files.map((file) => renderFile(file, 0))}
      {root.folders.map((folder) => renderFolder(folder, 1))}
    </ul>
    <footer>Shared state beneath the original request. The orchestrator owns structure; workers write notes; you can edit anything.</footer>
  </nav>
}

function countFiles(folder: ProjectFolder): number {
  return folder.files.length + folder.folders.reduce((sum, child) => sum + countFiles(child), 0)
}
