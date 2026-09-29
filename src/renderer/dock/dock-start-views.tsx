import { lazy, Suspense, useEffect, useRef, useState, type JSX } from 'react'
import { ArrowLeft, Search, X } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import type { AgentRunStartOptions } from '../../shared/agent-runs.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { ChatSearchFooter, ChatSearchResults, useChatSearchList } from '../chat-history/chat-search-results.js'
import type { HistoryController } from '../chat-history/history-controller.js'
import { useChatSearchActions } from '../chat-history/use-chat-search-actions.js'
import type { SettingsSectionsProps, SettingsTab } from '../settings/settings-sections.js'
import { START_SCREEN_TITLES, type StartScreen } from './dock-start-model.js'

const ChatHistory = lazy(async () => ({ default: (await import('../chat-history.js')).ChatHistory }))
const AgentLibraryView = lazy(async () => ({ default: (await import('../agent-library/agent-library-view.js')).AgentLibraryView }))
const ToolsPanel = lazy(async () => ({ default: (await import('../tools/tools-panel.js')).ToolsPanel }))
const SettingsSections = lazy(async () => ({ default: (await import('../settings/settings-sections.js')).SettingsSections }))

/** What Start's screens act on: the workspace's chats and the selected chat, owned by the app shell. */
export type StartServices = {
  chats: ChatRowSummary[]
  history: HistoryController
  /** The selected chat: Tools repair drafts go to its composer and agents dock beside its tile. */
  selectedPaneId: string | null
  /** The selected chat is running a turn; History cannot switch away from it until it pauses. */
  selectedBusy: boolean
  listChats: () => Promise<ChatRowSummary[]>
  archiveChat: (chatId: string) => Promise<void>
  openChat: (chatId: string) => Promise<void>
  sendToChat: (chatId: string, text: string) => void
  startAgent: (chatId: string, options: AgentRunStartOptions) => Promise<void>
  settings: Omit<SettingsSectionsProps, 'active' | 'tab' | 'onTabChange' | 'Title' | 'Description' | 'descriptionId'>
}

/**
 * One Start screen: a back header over the same panel its view tab or dialog shows. Anything that
 * takes you somewhere else (opening a chat, sending a repair draft, starting an agent, the
 * wallpaper picker) closes Start; Back and Escape return to Start's home.
 */
export function StartScreenView({ screen, services, onBack, onClose }: {
  screen: StartScreen
  services: StartServices
  onBack: () => void
  onClose: () => void
}): JSX.Element {
  const { selectedPaneId } = services
  return <div className="dock-start-screen" data-screen={screen}>
    <header className="dock-start-screen-head">
      <Button variant="ghost" size="icon-sm" data-ui="dock.start-back" aria-label="Back to Start" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
      </Button>
      <h2 className="dock-start-screen-title">{START_SCREEN_TITLES[screen]}</h2>
    </header>
    <div className="dock-start-screen-body">
      <Suspense fallback={null}>
        {screen === 'search-chats' && <StartChatSearch chats={services.chats} controller={services.history} onOpened={onClose} />}
        {screen === 'history' && <ChatHistory activeChatId={selectedPaneId} busy={services.selectedBusy}
          listChats={services.listChats} chats={services.chats} openChat={services.openChat}
          archiveChat={services.archiveChat} onClose={onBack} onOpened={onClose} />}
        {screen === 'agents' && <AgentLibraryView active startEnabled={selectedPaneId !== null} chats={services.chats}
          onOpenChat={(chatId) => { void services.openChat(chatId).then(onClose) }}
          onStart={async (options) => {
            if (!selectedPaneId) return
            await services.startAgent(selectedPaneId, options)
            onClose()
          }} />}
        {screen === 'tools' && <ToolsPanel active onSendToChat={(text) => {
          if (!selectedPaneId) return
          services.sendToChat(selectedPaneId, text)
          onClose()
        }} />}
        {screen === 'settings' && <StartSettings settings={services.settings} onClose={onClose} />}
      </Suspense>
    </div>
  </div>
}

function StartSettings({ settings, onClose }: { settings: StartServices['settings']; onClose: () => void }): JSX.Element {
  const [tab, setTab] = useState<SettingsTab>('appearance')
  return <SettingsSections {...settings} active tab={tab} onTabChange={setTab}
    onOpenWallpaper={() => { onClose(); settings.onOpenWallpaper() }} />
}

/**
 * Start's Search chats: the title-bar palette's ranking, rows, and keys in Start's body, so the
 * search box becomes a chat search without leaving the panel.
 */
function StartChatSearch({ chats, controller, onOpened }: {
  chats: ChatRowSummary[]
  controller: HistoryController
  onOpened: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const list = useChatSearchList(chats, query, controller.reviewQueue, true)
  const { open, remove, toggleTurn, changingTurn, busy } = useChatSearchActions(controller, {
    onOpened, keepFocus: () => inputRef.current?.focus()
  })
  const refreshChats = controller.refreshChats
  useEffect(() => { refreshChats() }, [refreshChats])
  const searching = query.trim() !== ''

  return <div className="dock-start-chat-search">
    <div className="chat-history">
      <label className="chat-history-search">
        <Search className="size-3.5" aria-hidden="true" />
        <input ref={inputRef} type="text" value={query} placeholder="Search chats" autoFocus
          aria-label="Search previous chat titles" role="combobox" aria-autocomplete="list" aria-haspopup="grid"
          aria-expanded="true" aria-controls={list.listId} aria-activedescendant={list.activeDescendant}
          autoComplete="off" spellCheck={false} data-ui="dock.start-chat-search"
          onChange={(event) => { setQuery(event.target.value); list.setHighlightId(null) }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              list.step(event.key === 'ArrowDown' ? 1 : -1)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              void open(list.current)
            }
          }} />
        {query && <button type="button" className="dock-start-chat-search-clear" aria-label="Clear chat search"
          data-ui="dock.start-chat-search-clear" onMouseDown={(event) => event.preventDefault()}
          onClick={() => { setQuery(''); list.setHighlightId(null); inputRef.current?.focus() }}>
          <X size={14} aria-hidden="true" />
        </button>}
      </label>
    </div>
    <div className="dock-start-chat-search-results" onMouseDown={(event) => event.preventDefault()}>
      <ChatSearchResults list={list} query={query} busy={busy} changingTurn={changingTurn}
        onOpen={(hit) => { void open(hit) }} onToggleTurn={(hit) => { void toggleTurn(hit) }}
        onDelete={(hit) => { void remove(hit) }} />
    </div>
    <ChatSearchFooter list={list} searching={searching} escape="Back" />
    {controller.error && <p className="chat-history-error" role="alert">{controller.error}</p>}
  </div>
}
