import type { JSX } from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Copy, Download, Edit3, Globe2, Loader2, Lock, PanelRightOpen, Plus, RefreshCw, Search, X } from 'lucide-react'
import { BrowserSiteIcon } from './browser-site-icon.js'
import type { BrowserController } from './browser-controller.js'
import type { BrowserTabInfo } from '../shared/types.js'
import { tabIndexForKey } from './browser-tab-navigation.js'
import { useBrowserDownloadsController, type BrowserDownloadsController } from './browser-downloads-controller.js'
import { BrowserDownloadsShelf } from './browser-downloads-shelf.js'
import { BrowserNavigationError } from './browser-navigation-error.js'
import { placeRowMenu, type MenuPlacement } from './side-drawer/drawer-row-position.js'

// Memoized: the pane stays mounted, and its native-view host ref and ResizeObserver must
// survive re-renders of the shell around it.
export const BrowserPane = memo(function BrowserPane({
  controller
}: {
  controller: BrowserController
}): JSX.Element {
  const downloads = useBrowserDownloadsController()
  return (
    <section className="browser-pane" aria-label="Browser" data-ui-surface="browser">
      <div className={`browser-shell ${downloads.isOpen ? 'has-downloads' : ''}`}>
        <BrowserTabs controller={controller} />
        <BrowserToolbar controller={controller} downloads={downloads} />
        {downloads.isOpen ? <BrowserDownloadsShelf controller={downloads} /> : null}
        <div className={`browser-frame ${controller.browser.navigationError ? 'has-navigation-error' : ''}`}>
          <div
            className={`browser-view-host ${controller.browser.navigationError ? 'is-navigation-error' : ''}`}
            id="browser-page"
            role="tabpanel"
            aria-label="Browser page"
            aria-hidden={controller.browser.navigationError ? 'true' : undefined}
            ref={controller.browserHostRef}
          />
          {controller.titlebarFreeze ? (
            <img className="browser-view-freeze" src={controller.titlebarFreeze.imageUrl} alt="" aria-hidden="true" />
          ) : null}
          {controller.browser.navigationError ? (
            <BrowserNavigationError
              error={controller.browser.navigationError}
              onRetry={() => { void window.closedai.browser.navigate(controller.browser.navigationError?.url ?? controller.browser.url).catch(() => {}) }}
              onReturn={() => { void window.closedai.browser.navigate(controller.browser.navigationError?.previousUrl ?? controller.browser.url).catch(() => {}) }}
            />
          ) : null}
        </div>
      </div>
    </section>
  )
})

function BrowserTabs({ controller }: { controller: BrowserController }): JSX.Element {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const [menuTarget, setMenuTarget] = useState<BrowserTabMenuTarget | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)

  function selectTab(id: string): void {
    tabRefs.current.get(id)?.focus()
    if (!controller.tabs.find((tab) => tab.id === id)?.active) void window.closedai.browser.selectTab(id)
  }

  function beginRename(tab: BrowserTabInfo): void {
    setRenaming({ id: tab.id, title: tab.customTitle ?? tab.title })
  }

  return (
    <div className="browser-tabstrip" role="tablist" aria-label="Browser tabs">
      {controller.tabs.map((tab, index) => (
        <div
          key={tab.id}
          className={`browser-tab ${tab.active ? 'is-active' : ''}`}
          onAuxClick={(event) => { if (event.button === 1) void window.closedai.browser.closeTab(tab.id) }}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenuTarget({ tab, index, x: event.clientX, y: event.clientY })
          }}
        >
          {renaming?.id === tab.id ? (
            <BrowserTabRename
              tab={tab}
              initialTitle={renaming.title}
              onCancel={() => setRenaming(null)}
              onCommit={(title) => {
                setRenaming(null)
                void window.closedai.browser.renameTab(tab.id, title)
              }}
            />
          ) : (
            <button
              ref={(node) => {
                if (node) tabRefs.current.set(tab.id, node)
                else tabRefs.current.delete(tab.id)
              }}
              id={`browser-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-controls="browser-page"
              aria-selected={tab.active}
              tabIndex={tab.active ? 0 : -1}
              className="browser-tab-select"
              data-ui="browser.tab"
              data-ui-key={tab.id}
              title={`Tab ${tab.pos} - ${tab.title || tab.url}`}
              aria-label={`Tab ${tab.pos}: ${tab.title || tab.url}`}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => {
                const nextIndex = tabIndexForKey(event.key, index, controller.tabs.length)
                if (nextIndex === null) return
                event.preventDefault()
                selectTab(controller.tabs[nextIndex].id)
              }}
            >
              <span className="browser-tab-pos" aria-hidden="true">{tab.pos}</span>
              <TabIcon tab={tab} />
              <span className="browser-tab-title">{tab.title || 'New Tab'}</span>
            </button>
          )}
          <button
            type="button"
            className="browser-tab-close"
            data-ui="browser.tab-close"
            data-ui-key={tab.id}
            aria-label={`Close tab ${tab.pos}: ${tab.title || 'untitled'}`}
            title={`Close tab ${tab.pos}`}
            onClick={(event) => {
              event.stopPropagation()
              void window.closedai.browser.closeTab(tab.id)
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button type="button" className="browser-tab-new" data-ui="browser.tab-new" aria-label="New tab" title="New tab" onClick={() => void window.closedai.browser.newTab()}>
        <Plus size={14} />
      </button>
      {menuTarget ? (
        <BrowserTabMenu
          target={menuTarget}
          tabCount={controller.tabs.length}
          onRename={beginRename}
          onClose={() => setMenuTarget(null)}
        />
      ) : null}
    </div>
  )
}

type BrowserTabMenuTarget = {
  tab: BrowserTabInfo
  index: number
  x: number
  y: number
}

const TAB_MENU_WIDTH = 214
const TAB_MENU_MAX_HEIGHT = 304

function BrowserTabMenu({
  target,
  tabCount,
  onRename,
  onClose
}: {
  target: BrowserTabMenuTarget
  tabCount: number
  onRename: (tab: BrowserTabInfo) => void
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<MenuPlacement | null>(null)
  const hasTabsToRight = target.index < tabCount - 1

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = (): void => {
      setPlacement(placeRowMenu(
        { x: target.x, y: target.y },
        { width: node.offsetWidth || TAB_MENU_WIDTH, maxHeight: TAB_MENU_MAX_HEIGHT },
        { width: window.innerWidth, height: window.innerHeight }
      ))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [target.x, target.y])

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const closeOnKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnKeyDown)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnKeyDown)
    }
  }, [onClose])

  const run = (action: () => void): void => {
    onClose()
    action()
  }

  return createPortal(
    <div
      ref={ref}
      className="browser-tab-menu"
      role="menu"
      aria-label={`Actions for ${target.tab.title || 'New Tab'}`}
      data-ui="browser.tab-menu"
      style={
        placement
          ? { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }
          : { left: target.x, top: target.y, visibility: 'hidden' }
      }
    >
      <BrowserTabMenuItem icon={<PanelRightOpen size={13} />} label="New tab to the right" item="new-right" onClick={() => run(() => { void window.closedai.browser.newTabToRight(target.tab.id) })} />
      <BrowserTabMenuItem icon={<RefreshCw size={13} />} label="Reload" item="reload" onClick={() => run(() => { void window.closedai.browser.reloadTab(target.tab.id) })} />
      <BrowserTabMenuItem icon={<Copy size={13} />} label="Duplicate" item="duplicate" onClick={() => run(() => { void window.closedai.browser.duplicateTab(target.tab.id) })} />
      <BrowserTabMenuItem icon={<Edit3 size={13} />} label="Rename" item="rename" onClick={() => run(() => onRename(target.tab))} />
      <BrowserTabMenuItem icon={<X size={13} />} label="Close" item="close" onClick={() => run(() => { void window.closedai.browser.closeTab(target.tab.id) })} />
      <div className="browser-tab-menu-separator" role="separator" />
      <BrowserTabMenuItem
        label="Close other tabs"
        item="close-others"
        disabled={tabCount <= 1}
        onClick={() => run(() => { void window.closedai.browser.closeOtherTabs(target.tab.id) })}
      />
      <BrowserTabMenuItem
        label="Close tabs to the right"
        item="close-right"
        disabled={!hasTabsToRight}
        onClick={() => run(() => { void window.closedai.browser.closeTabsToRight(target.tab.id) })}
      />
    </div>,
    document.body
  )
}

function BrowserTabMenuItem({
  icon,
  label,
  item,
  disabled = false,
  onClick
}: {
  icon?: JSX.Element
  label: string
  item: string
  disabled?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      className="browser-tab-menu-item"
      data-ui="browser.tab-menu-item"
      data-ui-key={item}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="browser-tab-menu-icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function BrowserTabRename({
  tab,
  initialTitle,
  onCancel,
  onCommit
}: {
  tab: BrowserTabInfo
  initialTitle: string
  onCancel: () => void
  onCommit: (title: string | null) => void
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initialTitle)

  useEffect(() => {
    const input = inputRef.current
    input?.focus()
    input?.select()
  }, [])

  const commit = (): void => onCommit(value.trim() || null)

  return (
    <form
      className="browser-tab-rename"
      role="tab"
      aria-controls="browser-page"
      aria-selected={tab.active}
      onSubmit={(event) => {
        event.preventDefault()
        commit()
      }}
    >
      <input
        ref={inputRef}
        className="browser-tab-rename-input"
        data-ui="browser.tab-rename"
        data-ui-key={tab.id}
        value={value}
        aria-label={`Rename tab ${tab.pos}`}
        spellCheck={false}
        onBlur={commit}
        onChange={(event) => setValue(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          onCancel()
        }}
      />
    </form>
  )
}

function TabIcon({ tab }: { tab: BrowserTabInfo }): JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [tab.favicon])
  if (tab.isLoading) return <Loader2 className="spin browser-tab-icon" size={12} aria-hidden="true" />
  if (tab.favicon && !failed) {
    return <img className="browser-tab-favicon" src={tab.favicon} alt="" aria-hidden="true" onError={() => setFailed(true)} />
  }
  return <Globe2 className="browser-tab-icon browser-tab-fallback" size={13} aria-hidden="true" />
}

function BrowserToolbar({
  controller,
  downloads
}: {
  controller: BrowserController
  downloads: BrowserDownloadsController
}): JSX.Element {
  const { browser, blur, focus, ghost, handleOmniboxChange, handleOmniboxKeyDown, identity, location, navigate, omniboxRef } = controller
  return (
    <form className="browser-toolbar" onSubmit={navigate}>
      <button type="button" className="browser-nav-button" disabled={!browser.canGoBack} onClick={() => { void window.closedai.browser.back().catch(() => {}) }} title="Back" aria-label="Back" data-ui="browser.back">
        <ArrowLeft size={16} />
      </button>
      <button type="button" className="browser-nav-button" disabled={!browser.canGoForward} onClick={() => { void window.closedai.browser.forward().catch(() => {}) }} title="Forward" aria-label="Forward" data-ui="browser.forward">
        <ArrowRight size={16} />
      </button>
      <button type="button" className="browser-nav-button" onClick={() => { void window.closedai.browser.reload().catch(() => {}) }} title="Reload" aria-label="Reload" data-ui="browser.reload">
        {browser.isLoading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
      </button>
      <div className="omnibox-field">
        <input
          ref={omniboxRef}
          className="omnibox"
          value={location}
          spellCheck={false}
          autoComplete="off"
          aria-label="Address"
          role="combobox"
          aria-autocomplete="both"
          aria-expanded={controller.suggestionsOpen && controller.suggestions.length > 0}
          aria-controls="browser-suggestions"
          aria-activedescendant={controller.suggestionsOpen && controller.selected >= 0 ? `browser-suggestion-${controller.selected}` : undefined}
          data-ui="browser.address"
          onFocus={focus}
          onBlur={blur}
          onChange={handleOmniboxChange}
          onKeyDown={handleOmniboxKeyDown}
        />
        {ghost && ghost.base === location ? (
          <div className="omnibox-ghost" aria-hidden="true">
            <span className="og-typed">{ghost.base}</span>
            <span className="og-suggest">{ghost.remainder}</span>
          </div>
        ) : null}
        {controller.suggestionsOpen && controller.suggestions.length > 0 ? (
          <div className="browser-suggestions" id="browser-suggestions" role="listbox" aria-label="Address suggestions">
            {controller.suggestions.map((row, index) => (
              <div className={`browser-suggestion ${index === controller.selected ? 'is-selected' : ''}`} key={row.kind + row.url}>
                <button
                  type="button"
                  role="option"
                  id={`browser-suggestion-${index}`}
                  aria-selected={index === controller.selected}
                  className="browser-suggestion-open"
                  data-ui="browser.suggestion"
                  data-ui-key={row.url}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => controller.choose(row.url)}
                >
                  {row.kind === 'search' ? <Search size={17} /> : <BrowserSiteIcon favicon={row.favicon} />}
                  <span className="browser-suggestion-title">{row.title || row.completion}</span>
                  <span className="browser-suggestion-detail">{row.completion}</span>
                </button>
                {row.kind === 'history' ? (
                  <button
                    type="button"
                    className="browser-suggestion-remove"
                    data-ui="browser.suggestion-remove"
                    data-ui-key={row.url}
                    aria-label={`Remove ${row.title || row.completion} from history`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => { void controller.removeHistory(row.url).catch(() => {}) }}
                  ><X size={14} /></button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {identity ? (
          <div className="omnibox-identity" aria-hidden="true">
            {identity.kind === 'web' ? (
              identity.secure ? <Lock className="oi-icon" /> : <span className="oi-insecure">Not secure</span>
            ) : null}
            <span className="oi-host">{identity.host}</span>
            {identity.rest ? <span className="oi-rest">{identity.rest}</span> : null}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className={`browser-nav-button ${downloads.isOpen ? 'is-active' : ''} ${downloads.hasActive ? 'is-busy' : ''}`}
        onClick={downloads.toggle}
        title="Downloads"
        aria-label="Downloads"
        data-ui="browser.downloads"
        aria-pressed={downloads.isOpen}
      >
        <Download size={16} />
      </button>
    </form>
  )
}
