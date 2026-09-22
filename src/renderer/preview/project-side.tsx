import { useEffect, useRef } from 'react'
import { Compass, ExternalLink } from 'lucide-react'

import { MessageText } from './project-intake.js'
import type { TreeNode } from './project-tree.js'

export type FeedLine = { id: number; text: string }

export function ProjectSide({ selected, feed }: { selected: TreeNode | null; feed: FeedLine[] }) {
  const list = useRef<HTMLOListElement>(null)

  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: 'nearest' })
  }, [feed.length])

  return <aside className="project-side" aria-label="Root coordinator">
    {selected && <section className="project-node-inspector" aria-live="polite">
      <div className="project-node-inspector-heading">
        <span data-state={selected.state}>{selected.state}</span>
        <strong>{selected.title}</strong>
      </div>
      <MessageText id={selected.id} text={selected.detail} />
      {selected.links && selected.links.length > 0 && <div className="project-node-sources">
        <span>Evidence</span>
        {selected.links.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer"
          title={link.informs} data-ui="preview.project-source" data-ui-key={link.url}>
          {link.label}<ExternalLink size={11} aria-hidden="true" />
        </a>)}
      </div>}
    </section>}

    <section className="project-feed">
      <header>
        <Compass size={13} aria-hidden="true" />
        <strong>Root coordinator</strong>
        {feed.length > 0 && <span>coordinating</span>}
      </header>
      <ol ref={list}>
        {feed.map((line) => <li key={line.id}>{line.text}</li>)}
      </ol>
    </section>
  </aside>
}
