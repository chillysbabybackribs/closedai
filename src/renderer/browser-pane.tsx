import type { JSX } from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Download, FileImage, Globe2, Loader2, Lock, Plus, RefreshCw, Search, X } from 'lucide-react'
import { ImageViewer } from './image-viewer/image-viewer.js'
import { BrowserSiteIcon } from './browser-site-icon.js'
import type { BrowserController } from './browser-controller.js'
import type { BrowserTabInfo } from '../shared/types.js'
import { tabIndexForKey } from './browser-tab-navigation.js'
import { useBrowserDownloadsController, type BrowserDownloadsController } from './browser-downloads-controller.js'
import { BrowserDownloadsShelf } from './browser-downloads-shelf.js'
import { BrowserNavigationError } from './browser-navigation-error.js'
import { BrowserTabMenu, BrowserTabRename, type BrowserTabMenuTarget } from './browser-tab-menu.js'

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
        {!controller.browser.image && <BrowserToolbar controller={controller} downloads={downloads} />}
        {downloads.isOpen ? <BrowserDownloadsShelf controller={downloads} /> : null}
        <div className={`browser-frame ${controller.browser.navigationError ? 'has-navigation-error' : ''}`}>
          <div
            className={`browser-view-host ${controller.browser.image ? 'is-image-viewer' : controller.browser.navigationError ? 'is-navigation-error' : ''}`}
            id="browser-page"
            role="tabpanel"
            aria-label="Browser page"
            aria-hidden={controller.browser.image || controller.browser.navigationError ? 'true' : undefined}
            ref={controller.browserHostRef}
          />
          {controller.titlebarFreeze && !controller.browser.image ? (
            <img className="browser-view-freeze" src={controller.titlebarFreeze.imageUrl} alt="" aria-hidden="true" />
          ) : null}
          {controller.tabs.filter((tab) => tab.image).map((tab) =>
            <ImageViewer key={tab.id} id={tab.id} active={controller.browser.image?.tabId === tab.id} />)}
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
              aria-controls={tab.image ? `image-page-${tab.id}` : 'browser-page'}
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

function TabIcon({ tab }: { tab: BrowserTabInfo }): JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [tab.favicon])
  if (tab.image) return <FileImage className="browser-tab-icon" size={13} aria-hidden="true" />
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
