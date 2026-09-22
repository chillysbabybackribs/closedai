import { useEffect, useState } from 'react'
import { ChevronRight, ExternalLink, LockKeyhole, Pencil } from 'lucide-react'

import { Markdown } from '../../components/ui/markdown.js'
import type { Crumb, Location, ProjectFile } from './project-files.js'
import type { TreeNode } from './project-tree.js'

const STATE_WORDS: Record<TreeNode['state'], string> = {
  anchored: 'anchored', active: 'in progress', queued: 'queued', complete: 'complete',
  provisional: 'working hypothesis', confirmed: 'confirmed'
}

export function Breadcrumbs({ crumbs, onNavigate }: { crumbs: Crumb[]; onNavigate: (location: Location) => void }) {
  return <nav className="project-crumbs" aria-label="Breadcrumb">
    {crumbs.map((crumb, index) => {
      const last = index === crumbs.length - 1
      return <span key={`${crumb.label}-${index}`}>
        {index > 0 && <ChevronRight size={11} aria-hidden="true" />}
        {last
          ? <strong aria-current="page">{crumb.label}</strong>
          : crumb.location
            ? <button type="button" data-ui="preview.project-crumb" data-ui-key={String(index)}
              onClick={() => onNavigate(crumb.location!)}>{crumb.label}</button>
            : <em>{crumb.label}</em>}
      </span>
    })}
  </nav>
}

/** A map node opened into the full canvas: purpose, trace to intent, state, evidence, children, files. */
export function NodeDetail(props: {
  node: TreeNode
  nodes: TreeNode[]
  files: ProjectFile[]
  serves: string
  onNavigate: (location: Location) => void
}) {
  const { node, nodes, files, serves, onNavigate } = props
  const children = nodes.filter((child) => child.parent === node.id && child.kind !== 'amendment')
  const amendments = nodes.filter((child) => child.parent === node.id && child.kind === 'amendment')
  return <article className="project-detail">
    <header className="project-detail-heading">
      <span className="project-detail-kind">{node.kind}</span>
      <h1>{node.kind === 'root' && <LockKeyhole size={15} aria-hidden="true" />}{node.title}</h1>
      <span className="project-detail-state" data-state={node.state}>{STATE_WORDS[node.state]}</span>
    </header>
    {node.kind !== 'root' && <p className="project-detail-serves"><b>Serves</b> {serves}</p>}
    <div className="project-detail-body"><Markdown>{node.detail}</Markdown></div>
    {node.links && node.links.length > 0 && <section className="project-detail-section">
      <h2>Evidence</h2>
      <ul className="project-detail-links">
        {node.links.map((link) => <li key={link.url}>
          <a href={link.url} target="_blank" rel="noreferrer" data-ui="preview.project-source" data-ui-key={link.url}>
            {link.label}<ExternalLink size={11} aria-hidden="true" />
          </a>
          <small>{link.informs}</small>
        </li>)}
      </ul>
    </section>}
    {amendments.length > 0 && <section className="project-detail-section">
      <h2>Amendments</h2>
      <ul className="project-detail-list">
        {amendments.map((amendment) => <li key={amendment.id}>
          <button type="button" data-ui="preview.project-node" data-ui-key={amendment.id}
            onClick={() => onNavigate({ kind: 'node', id: amendment.id })}>{amendment.summary}</button>
        </li>)}
      </ul>
    </section>}
    {children.length > 0 && <section className="project-detail-section">
      <h2>Beneath this</h2>
      <ul className="project-detail-list">
        {children.map((child) => <li key={child.id}>
          <button type="button" data-ui="preview.project-node" data-ui-key={child.id}
            onClick={() => onNavigate({ kind: 'node', id: child.id })}>
            <span className="project-detail-dot" data-state={child.state} aria-hidden="true" />
            <strong>{child.title}</strong><small>{child.summary}</small>
          </button>
        </li>)}
      </ul>
    </section>}
    {files.length > 0 && <section className="project-detail-section">
      <h2>Files</h2>
      <ul className="project-detail-list">
        {files.map((file) => <li key={file.path}>
          <button type="button" data-ui="preview.project-file" data-ui-key={file.path}
            onClick={() => onNavigate({ kind: 'file', path: file.path })}>
            <strong>{file.title}</strong><small>{file.path}</small>
          </button>
        </li>)}
      </ul>
    </section>}
  </article>
}

/** A project file opened into the canvas, readable and, unless it is history, editable in place. */
export function FileDetail({ file, onSave }: { file: ProjectFile; onSave: (path: string, content: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(file.content)
  useEffect(() => { setEditing(false); setDraft(file.content) }, [file.path, file.content])
  const dirty = draft !== file.content

  return <article className="project-detail is-file">
    <header className="project-detail-heading">
      <span className="project-detail-kind">{file.owner} · {file.path}</span>
      <h1>{file.title}</h1>
      {file.editable
        ? (editing
          ? <span className="project-detail-actions">
            <button type="button" data-ui="preview.project-file-cancel" onClick={() => { setDraft(file.content); setEditing(false) }}>Cancel</button>
            <button type="button" className="is-primary" data-ui="preview.project-file-save" disabled={!dirty}
              onClick={() => { onSave(file.path, draft); setEditing(false) }}>Save</button>
          </span>
          : <button type="button" className="project-detail-edit" data-ui="preview.project-file-edit" onClick={() => setEditing(true)}>
            <Pencil size={12} aria-hidden="true" /> Edit
          </button>)
        : <span className="project-detail-state" data-state="anchored"><LockKeyhole size={11} aria-hidden="true" /> history</span>}
    </header>
    {editing
      ? <textarea className="project-file-editor" data-ui="preview.project-file-editor" value={draft}
        onChange={(event) => setDraft(event.target.value)} spellCheck={false} />
      : <div className="project-detail-body"><Markdown>{file.content}</Markdown></div>}
  </article>
}
