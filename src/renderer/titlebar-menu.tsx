import { memo, useRef, type JSX } from 'react'
import { Menubar } from 'radix-ui'
import { MENUS, menuItemDisabled, runMenuItem, type MenuRow, type TitlebarMenuProps } from './application-menu-model.js'
export type { MenuAction, TitlebarMenuProps } from './application-menu-model.js'

/** The shell's File / View / Agent / Developer bar, sitting in the title bar's drag region. */
export const TitlebarMenu = memo(function TitlebarMenu({
  chatZoom,
  selectedChatTitle,
  compactEnabled,
  stopEnabled,
  onChatZoomChange,
  onAction,
  onSearchChats,
  layoutEnabled,
  tileEnabled,
  onApplyLayoutPreset
}: TitlebarMenuProps): JSX.Element {
  const searchOnClose = useRef(false)
  const disabled = (row: Extract<MenuRow, { key: string }>): boolean => {
    return menuItemDisabled(row, { chatZoom, tileEnabled, layoutEnabled, compactEnabled, stopEnabled })
  }

  // A click opens a menu; once one is open, moving across the bar switches menus like a native
  // menubar. Outside click, Escape, or choosing a row closes it.
  return (
    <Menubar.Root className="titlebar-nav-menu" aria-label="Application menu">
      <div className="titlebar-nav-group">
        {MENUS.map((menu) => (
          <Menubar.Menu key={menu.key} value={menu.key}>
            <Menubar.Trigger className="titlebar-nav-tab" data-ui="titlebar.menu" data-ui-key={menu.key}>
              {menu.label}
            </Menubar.Trigger>
            <Menubar.Portal>
              <Menubar.Content className="titlebar-menu-content" align="start" sideOffset={4} loop
                onCloseAutoFocus={event => {
                  if (!searchOnClose.current) return
                  event.preventDefault()
                  searchOnClose.current = false
                  onSearchChats()
                }}>
                {menu.rows.map((row, index) => {
                  if (row.kind === 'separator') {
                    return <Menubar.Separator key={`sep-${index}`} className="titlebar-menu-separator" />
                  }
                  if (row.kind === 'heading') {
                    return (
                      <Menubar.Label key={`heading-${index}`} className="titlebar-menu-heading">
                        {row.label}{selectedChatTitle ? <span className="titlebar-menu-heading-name"> · {selectedChatTitle}</span> : null}
                      </Menubar.Label>
                    )
                  }
                  const onSelect = (): void => {
                    // The search field is focused after the menu's own close-focus, not before it.
                    if (row.action === 'search-chats') searchOnClose.current = true
                    else runMenuItem(row, { onChatZoomChange, onApplyLayoutPreset, onSearchChats, onAction })
                  }
                  const itemLabel = (
                    <>
                      <span>{row.label}</span>
                      {row.shortcut && (
                        <span className="titlebar-menu-shortcut">
                          {row.command === 'reset' ? `${chatZoom}%  ` : ''}{row.shortcut}
                        </span>
                      )}
                    </>
                  )
                  if (row.layoutPreset) {
                    return (
                      <Menubar.Item key={row.key} className="titlebar-menu-item" data-ui="layout.dock-preset"
                        data-ui-key={row.ui!.item!} disabled={disabled(row)} onSelect={onSelect}>
                        {itemLabel}
                      </Menubar.Item>
                    )
                  }
                  if (row.action === 'layout') {
                    return (
                      <Menubar.Item key={row.key} className="titlebar-menu-item" data-ui="layout.preset-menu-custom"
                        data-ui-key={row.key} disabled={disabled(row)} onSelect={onSelect}>
                        {itemLabel}
                      </Menubar.Item>
                    )
                  }
                  return (
                    <Menubar.Item key={row.key} className="titlebar-menu-item" data-ui="titlebar.menu-item"
                      data-ui-key={row.key} disabled={disabled(row)} onSelect={onSelect}>
                      {itemLabel}
                    </Menubar.Item>
                  )
                })}
              </Menubar.Content>
            </Menubar.Portal>
          </Menubar.Menu>
        ))}
      </div>
    </Menubar.Root>
  )
})
