import { memo, type JSX } from 'react'
import { Menubar } from 'radix-ui'

/** One menu's worth of rows. `null` is a separator. */
type MenuRow = { label: string; shortcut?: string } | null

type Menu = { label: string; rows: MenuRow[] }

/* Placeholder shell menus, matching the desktop apps this chrome is modelled on.
   Nothing is wired yet: every row renders disabled so the bar shows the intended
   command surface without claiming actions the app does not perform. */
const MENUS: Menu[] = [
  {
    label: 'File',
    rows: [
      { label: 'New chat', shortcut: 'Ctrl+N' },
      { label: 'Open chat history', shortcut: 'Ctrl+H' },
      null,
      { label: 'Settings', shortcut: 'Ctrl+,' },
      null,
      { label: 'Close window', shortcut: 'Ctrl+W' }
    ]
  },
  {
    label: 'Edit',
    rows: [
      { label: 'Undo', shortcut: 'Ctrl+Z' },
      { label: 'Redo', shortcut: 'Ctrl+Shift+Z' },
      null,
      { label: 'Cut', shortcut: 'Ctrl+X' },
      { label: 'Copy', shortcut: 'Ctrl+C' },
      { label: 'Paste', shortcut: 'Ctrl+V' },
      null,
      { label: 'Find in chat', shortcut: 'Ctrl+F' }
    ]
  },
  {
    label: 'View',
    rows: [
      { label: 'Reload', shortcut: 'Ctrl+R' },
      { label: 'Toggle browser pane' },
      null,
      { label: 'Zoom in', shortcut: 'Ctrl+=' },
      { label: 'Zoom out', shortcut: 'Ctrl+-' },
      { label: 'Actual size', shortcut: 'Ctrl+0' },
      null,
      { label: 'Full screen', shortcut: 'F11' }
    ]
  },
  {
    label: 'Help',
    rows: [
      { label: 'Documentation' },
      { label: 'Keyboard shortcuts' },
      null,
      { label: 'About ClosedAI' }
    ]
  }
]

/** The shell's File / Edit / View / Help bar, sitting in the title bar's drag region. */
export const TitlebarMenu = memo(function TitlebarMenu(): JSX.Element {
  return (
    <Menubar.Root className="titlebar-nav-menu" aria-label="Application menu">
      <div className="titlebar-nav-group">
        {MENUS.map((menu) => (
          <Menubar.Menu key={menu.label}>
            <Menubar.Trigger className="titlebar-nav-tab">{menu.label}</Menubar.Trigger>
            <Menubar.Portal>
              <Menubar.Content className="titlebar-menu-content" align="start" sideOffset={4} loop>
                {menu.rows.map((row, index) =>
                  row === null ? (
                    <Menubar.Separator key={`sep-${index}`} className="titlebar-menu-separator" />
                  ) : (
                    <Menubar.Item key={row.label} className="titlebar-menu-item" disabled>
                      <span>{row.label}</span>
                      {row.shortcut && <span className="titlebar-menu-shortcut">{row.shortcut}</span>}
                    </Menubar.Item>
                  )
                )}
              </Menubar.Content>
            </Menubar.Portal>
          </Menubar.Menu>
        ))}
      </div>
    </Menubar.Root>
  )
})
