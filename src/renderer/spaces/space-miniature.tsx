import { memo, useMemo, type CSSProperties, type ReactElement } from 'react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { BROWSER_PANE_ID, isViewTabId, layoutGeometry, readLayout, removePane } from '../chat-layout/layout-tree.js'
import { VIEW_LABELS, parseViewTab } from '../chat-layout/layout-views.js'
import type { Size } from './spaces-model.js'

/** The canvas gutter around tiles (`.chat-layout-viewport` padding), so the drawing lines up with the live space. */
const GUTTER = { top: 2, side: 8, bottom: 8 }

type MiniatureTab = { id: string; title: string; state: 'idle' | 'working' | 'paused'; preview: string }

/**
 * A space the user is not in, drawn from its saved layout at full stage size (the slot scales it).
 * Only the space you came from is live DOM; this costs a few divs per tile, and each tab's running
 * or paused mark comes from the workspace-wide chat rows, so it stays current while zoomed out.
 */
export const SpaceMiniature = memo(function SpaceMiniature({ cwd, size, chats }: {
  cwd: string
  size: Size
  chats: readonly ChatRowSummary[]
}): ReactElement {
  const saved = useMemo(() => readLayout(window.localStorage, cwd), [cwd])
  const rows = useMemo(() => new Map(chats.map((row) => [row.paneId, row])), [chats])
  const geometry = useMemo(() => {
    const tree = saved.tree && !saved.browserVisible ? removePane(saved.tree, BROWSER_PANE_ID) : saved.tree
    const width = size.width - 2 * GUTTER.side
    const height = size.height - GUTTER.top - GUTTER.bottom
    return tree && width > 0 && height > 0 ? layoutGeometry(tree, width, height) : null
  }, [saved, size.width, size.height])
  const tab = (id: string): MiniatureTab => {
    const view = parseViewTab(id)
    if (view) return { id, title: VIEW_LABELS[view.kind], state: 'idle', preview: '' }
    const row = rows.get(id)
    return { id, title: row?.title ?? 'New chat', state: row?.running ? 'working' : row?.paused ? 'paused' : 'idle', preview: row?.preview ?? '' }
  }
  return <div className="spaces-mini" style={{ width: size.width, height: size.height }} aria-hidden="true">
    {!geometry && <div className="spaces-mini-empty">Opens with its last chats</div>}
    {geometry?.panes.map((pane) => {
      const style: CSSProperties = { left: pane.rect.x + GUTTER.side, top: pane.rect.y + GUTTER.top, width: pane.rect.width, height: pane.rect.height }
      if (pane.id === BROWSER_PANE_ID) {
        return <div key={pane.id} className="spaces-mini-tile" data-kind="browser" style={style}>
          <div className="spaces-mini-header"><span className="spaces-mini-tab" data-active="true">Browser</span></div>
          <div className="spaces-mini-page" />
        </div>
      }
      const tabs = pane.tabs.map(tab)
      const active = tabs.find((entry) => entry.id === pane.id)
      return <div key={pane.id} className="spaces-mini-tile" data-kind={isViewTabId(pane.id) ? 'view' : 'chat'} style={style}>
        <div className="spaces-mini-header">
          {tabs.map((entry) => <span key={entry.id} className="spaces-mini-tab" data-active={entry.id === pane.id} data-status={entry.state}>
            {entry.state !== 'idle' && <i className="spaces-mini-status" />}{entry.title}
          </span>)}
        </div>
        <div className="spaces-mini-body">
          {isViewTabId(pane.id) ? <span className="spaces-mini-view">{active?.title}</span>
            : active?.preview ? <p className="spaces-mini-preview">{active.preview}</p> : null}
          <span className="spaces-mini-composer" />
        </div>
      </div>
    })}
  </div>
})
