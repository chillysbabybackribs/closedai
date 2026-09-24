import type { ReactNode } from 'react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut,
  DropdownMenuTrigger
} from '../../components/ui/dropdown-menu.js'
import { Activity, Bot, Globe, History, MessageSquarePlus, Plus, Wrench } from 'lucide-react'
import { VIEW_KINDS, VIEW_LABELS, type ViewKind } from './layout-views.js'

const ICON = 15
/** Header 38px, trigger 26px centered: this drops the menu 4px below the header's bottom edge. */
const BELOW_HEADER = 10

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
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <button type="button" className="chat-layout-new-chat" data-ui="layout.add" data-ui-key={tileId} disabled={busy}
        title="New chat or open a view here" aria-label="New chat or open a view in this pane">
        <Plus size={14} aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="min-w-[220px]" align="end" sideOffset={BELOW_HEADER} loop>
      <AddMenuRow data-ui="layout.new-chat" data-ui-key={tileId} label="New chat"
        icon={<MessageSquarePlus size={ICON} aria-hidden="true" />} onSelect={onNewChat} />
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Open in this pane</DropdownMenuLabel>
      {VIEW_KINDS.map((kind) => <AddMenuRow key={kind} data-ui="layout.open-view" data-ui-key={kind}
        label={VIEW_LABELS[kind]} meta={hints?.[kind]} icon={VIEW_ICONS[kind]({ size: ICON, 'aria-hidden': true })}
        onSelect={() => onOpenView(kind)} />)}
      {onShowBrowser && <>
        <DropdownMenuSeparator />
        <AddMenuRow data-ui="layout.open-browser" data-ui-key={tileId} label="Browser"
          meta={browserVisible ? 'Open' : undefined} icon={<Globe size={ICON} aria-hidden="true" />}
          onSelect={onShowBrowser} />
      </>}
    </DropdownMenuContent>
  </DropdownMenu>
}

function AddMenuRow({ label, meta, icon, onSelect, ...rest }: {
  label: string
  meta?: string
  icon: ReactNode
  onSelect: () => void
  'data-ui': string
  'data-ui-key': string
}): ReactNode {
  return <DropdownMenuItem onSelect={onSelect} {...rest}>
    {icon}
    <span className="truncate">{label}</span>
    {meta && <DropdownMenuShortcut>{meta}</DropdownMenuShortcut>}
  </DropdownMenuItem>
}
