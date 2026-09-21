import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Edit3, PanelRightOpen, RefreshCw, X } from 'lucide-react'
import type { BrowserTabInfo } from '../shared/types.js'
import { placeRowMenu, type MenuPlacement } from './menu-position.js'
import { menuIndexForKey, tabPanelId } from './browser-tab-navigation.js'

export type BrowserTabMenuTarget = {
  tab: BrowserTabInfo
  index: number
  x: number
  y: number
}

const TAB_MENU_WIDTH = 214
const TAB_MENU_MAX_HEIGHT = 304
const ITEMS = '[role="menuitem"]:not(:disabled)'

export function BrowserTabMenu({
  target,
  tabCount,
  onRename,
  onError,
  onClose
}: {
  target: BrowserTabMenuTarget
  tabCount: number
  onRename: (tab: BrowserTabInfo) => void
  onError: (reason: unknown) => void
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

  // The first row takes focus once the menu is placed (a visibility-hidden menu cannot be focused).
  const focusedOnce = useRef(false)
  useEffect(() => {
    if (!placement || focusedOnce.current) return
    focusedOnce.current = true
    ref.current?.querySelector<HTMLButtonElement>(ITEMS)?.focus()
  }, [placement])

  // Closing by keyboard or after a row hands focus back to the tab; a pointer elsewhere keeps its own target.
  const close = (restoreFocus: boolean): void => {
    onClose()
    if (restoreFocus) document.getElementById(`browser-tab-${target.tab.id}`)?.focus()
  }
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) closeRef.current(false)
    }
    const closeOnKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeRef.current(true)
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnKeyDown)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnKeyDown)
    }
  }, [])

  const rove = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? [])]
    const next = menuIndexForKey(event.key, Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement)), items.length)
    if (next === null) return
    event.preventDefault()
    items[next]!.focus()
  }

  const run = (action: () => void): void => {
    close(true)
    action()
  }
  const call = (operation: () => Promise<unknown>) => () => run(() => { void operation().catch(onError) })
  const { browser } = window.closedai

  return createPortal(
    <div
      ref={ref}
      className="browser-tab-menu"
      role="menu"
      aria-label={`Actions for ${target.tab.title || 'New tab'}`}
      data-ui="browser.tab-menu"
      onKeyDown={rove}
      style={
        placement
          ? { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }
          : { left: target.x, top: target.y, visibility: 'hidden' }
      }
    >
      <BrowserTabMenuItem
        icon={<PanelRightOpen size={13} />}
        label="New tab to the right"
        item="new-right"
        onClick={call(() => browser.newTabToRight(target.tab.id))}
      />
      <BrowserTabMenuItem
        icon={<RefreshCw size={13} />}
        label="Reload"
        item="reload"
        onClick={call(() => browser.reloadTab(target.tab.id))}
      />
      <BrowserTabMenuItem
        icon={<Copy size={13} />}
        label="Duplicate"
        item="duplicate"
        onClick={call(() => browser.duplicateTab(target.tab.id))}
      />
      <BrowserTabMenuItem
        icon={<Edit3 size={13} />}
        label="Rename"
        item="rename"
        onClick={() => run(() => onRename(target.tab))}
      />
      <BrowserTabMenuItem
        icon={<X size={13} />}
        label="Close"
        item="close"
        onClick={call(() => browser.closeTab(target.tab.id))}
      />
      <div className="browser-tab-menu-separator" role="separator" />
      <BrowserTabMenuItem
        label="Close other tabs"
        item="close-others"
        disabled={tabCount <= 1}
        onClick={call(() => browser.closeOtherTabs(target.tab.id))}
      />
      <BrowserTabMenuItem
        label="Close tabs to the right"
        item="close-right"
        disabled={!hasTabsToRight}
        onClick={call(() => browser.closeTabsToRight(target.tab.id))}
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
      tabIndex={-1}
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

export function BrowserTabRename({
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
      aria-controls={tabPanelId(tab)}
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
