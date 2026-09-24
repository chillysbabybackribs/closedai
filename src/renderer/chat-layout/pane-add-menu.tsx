import type { ReactNode } from 'react'
import { DropdownMenu } from 'radix-ui'
import { Activity, Bot, Globe, History, MessageSquarePlus, Plus, Wrench } from 'lucide-react'
import { VIEW_KINDS, VIEW_LABELS, type ViewKind } from './layout-views.js'

const ICON = 16

/** The one new control of workspace views: the tile's + grows from "new chat" into a menu of things the tile can show. */
export const VIEW_ICONS: Record<ViewKind, (props: { size?: number; className?: string; 'aria-hidden'?: boolean | 'true' }) => ReactNode> = {
  trace: (props) => <Activity {...props} />,
  agents: (props) => <Bot {...props} />,
  history: (props) => <History {...props} />,
  tools: (props) => <Wrench {...props} />
}

export type ViewHints = Partial<Record<ViewKind, string>>

export function PaneAddMenu({ tileId, busy, hints, browserVisible, onNewChat, onOpenView, onShowBrowser }: {
  tileId: string
  busy: boolean
  /** Live one-word facts per view row, e.g. tools: 'Read-only'. */
  hints?: ViewHints
  browserVisible: boolean
  onNewChat: () => void
  onOpenView: (kind: ViewKind) => void
  onShowBrowser?: () => void
}): ReactNode {
  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger asChild>
      <button type="button" className="chat-layout-new-chat" data-ui="layout.add" data-ui-key={tileId} disabled={busy}
        title="New chat or open a view here" aria-label="New chat or open a view in this pane">
        <Plus size={14} aria-hidden="true" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="titlebar-menu-content chat-layout-context-menu chat-layout-add-menu" align="end" sideOffset={4} loop>
        <AddMenuRow data-ui="layout.new-chat" data-ui-key={tileId} label="New chat"
          icon={<MessageSquarePlus size={ICON} aria-hidden="true" />} onSelect={onNewChat} />
        <DropdownMenu.Separator className="titlebar-menu-separator" />
        <DropdownMenu.Label className="titlebar-menu-heading chat-layout-add-menu-heading">Open view in this pane</DropdownMenu.Label>
        {VIEW_KINDS.map((kind) => <AddMenuRow key={kind} data-ui="layout.open-view" data-ui-key={kind}
          label={VIEW_LABELS[kind]} meta={hints?.[kind]} icon={VIEW_ICONS[kind]({ size: ICON, 'aria-hidden': true })}
          onSelect={() => onOpenView(kind)} />)}
        {onShowBrowser && <>
          <DropdownMenu.Separator className="titlebar-menu-separator" />
          <AddMenuRow data-ui="layout.open-browser" data-ui-key={tileId} label="Browser"
            meta={browserVisible ? 'already open' : undefined} icon={<Globe size={ICON} aria-hidden="true" />}
            onSelect={onShowBrowser} />
        </>}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}

function AddMenuRow({ label, meta, icon, onSelect, ...rest }: {
  label: string
  meta?: string
  icon: ReactNode
  onSelect: () => void
  'data-ui': string
  'data-ui-key': string
}): ReactNode {
  return <DropdownMenu.Item className="titlebar-menu-item chat-layout-menu-item chat-layout-add-menu-item" onSelect={onSelect} {...rest}>
    <div className="chat-layout-menu-item-left">
      {icon}
      <span>{label}</span>
    </div>
    {meta && <span className="chat-layout-add-menu-meta">{meta}</span>}
  </DropdownMenu.Item>
}
