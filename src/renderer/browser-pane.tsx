import type { JSX } from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Download, Globe2, Loader2, Lock, Plus, RefreshCw, X } from 'lucide-react'
import type { BrowserController } from './browser-controller.js'
import type { BrowserTabInfo } from '../shared/types.js'
import { tabIndexForKey } from './browser-tab-navigation.js'
import { useBrowserDownloadsController, type BrowserDownloadsController } from './browser-downloads-controller.js'
import { BrowserDownloadsShelf } from './browser-downloads-shelf.js'
import { BrowserNavigationError } from './browser-navigation-error.js'

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

  function selectTab(id: string): void {
    tabRefs.current.get(id)?.focus()
    if (!controller.tabs.find((tab) => tab.id === id)?.active) void window.closedai.browser.selectTab(id)
  }

  return (
    <div className="browser-tabstrip" role="tablist" aria-label="Browser tabs">
      {controller.tabs.map((tab, index) => (
        <div
          key={tab.id}
          className={`browser-tab ${tab.active ? 'is-active' : ''}`}
          onAuxClick={(event) => { if (event.button === 1) void window.closedai.browser.closeTab(tab.id) }}
        >
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
            title={`Tab ${tab.pos} — ${tab.title || tab.url}`}
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
          <button
            type="button"
            className="browser-tab-close"
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
      <button type="button" className="browser-tab-new" aria-label="New tab" title="New tab" onClick={() => void window.closedai.browser.newTab()}>
        <Plus size={14} />
      </button>
    </div>
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
      <button type="button" className="browser-nav-button" disabled={!browser.canGoBack} onClick={() => { void window.closedai.browser.back().catch(() => {}) }} title="Back" aria-label="Back">
        <ArrowLeft size={16} />
      </button>
      <button type="button" className="browser-nav-button" disabled={!browser.canGoForward} onClick={() => { void window.closedai.browser.forward().catch(() => {}) }} title="Forward" aria-label="Forward">
        <ArrowRight size={16} />
      </button>
      <button type="button" className="browser-nav-button" onClick={() => { void window.closedai.browser.reload().catch(() => {}) }} title="Reload" aria-label="Reload">
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
        aria-pressed={downloads.isOpen}
      >
        <Download size={16} />
      </button>
    </form>
  )
}
