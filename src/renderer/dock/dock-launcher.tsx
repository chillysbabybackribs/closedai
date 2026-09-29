import { useRef, useState, type JSX } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Tabs } from 'radix-ui'
import { Grid2X2, Search } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '../../components/ui/command.js'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js'
import { MENUS, launcherGroups, menuItemDisabled, type MenuItem, type TitlebarMenuProps } from '../application-menu-model.js'

export function DockLauncher({ open, onOpenChange, menu }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  menu: TitlebarMenuProps
}): JSX.Element {
  const [section, setSection] = useState('home')
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const pending = useRef<MenuItem | null>(null)
  const groups = launcherGroups(section, query)

  function execute(row: MenuItem): void {
    if (row.command) menu.onChatZoomChange(row.command)
    else if (row.layoutPreset) menu.onApplyLayoutPreset(row.layoutPreset)
    else if (row.action === 'search-chats') menu.onSearchChats()
    else menu.onAction(row.action)
  }

  return <Popover open={open} onOpenChange={(next) => {
    if (next) { setQuery(''); setSection('home') }
    onOpenChange(next)
  }}>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="icon-sm" data-ui="dock.launcher" aria-label="Open launcher">
        <Grid2X2 aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    {/* Register after the trigger so Radix retains this anchor when its trigger anchor unmounts. */}
    <PopoverAnchor className="pointer-events-none absolute left-0 top-0 h-px w-px" />
    <PopoverContent side="top" align="start" sideOffset={0} avoidCollisions={false}
      className="dock-launcher" aria-label="Application launcher"
      onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus() }}
      onCloseAutoFocus={(event) => {
        const row = pending.current
        if (!row) return
        event.preventDefault()
        pending.current = null
        // Let the closing popover release focus before an action opens another surface.
        execute(row)
      }}>
      <Tabs.Root value={section} onValueChange={(value) => { setSection(value); setQuery('') }} className="dock-launcher-tabs">
        <Tabs.List className="titlebar-nav-group" aria-label="Launcher sections">
          {[{ key: 'home', label: 'Home' }, ...MENUS].map(tab => <Tabs.Trigger key={tab.key}
            value={tab.key} className="titlebar-nav-tab" data-ui="dock.launcher-section" data-ui-key={tab.key}>
            {tab.label}
          </Tabs.Trigger>)}
        </Tabs.List>
        <Tabs.Content value={section} className="dock-launcher-command">
          <Command shouldFilter={false} loop className="dock-launcher-command" label="Application commands">
            <CommandList className="dock-launcher-list">
              <CommandEmpty>No commands found.</CommandEmpty>
              {groups.map(group => <CommandGroup key={group.key} heading={group.label}>
                {group.rows.map(row => {
                  if (!('key' in row)) return null
                  return <CommandItem key={row.key} value={row.key}
                    data-ui={row.ui?.control ?? 'titlebar.menu-item'} data-ui-key={row.ui?.item ?? row.key}
                    disabled={menuItemDisabled(row, menu)}
                    onSelect={() => { pending.current = row; onOpenChange(false) }}>
                    <span>{row.label}</span>
                    {row.shortcut && <span className="titlebar-menu-shortcut">
                      {row.command === 'reset' ? `${menu.chatZoom}%  ` : ''}{row.shortcut}
                    </span>}
                  </CommandItem>
                })}
              </CommandGroup>)}
            </CommandList>
            {section === 'agent' && !query && <p className="dock-launcher-context">
              Selected chat: {menu.selectedChatTitle ?? 'No chat selected'}
            </p>}
            <div className="dock-launcher-search">
              <Search size={15} aria-hidden="true" />
              <CommandPrimitive.Input ref={input} value={query} onValueChange={setQuery}
                data-ui="dock.launcher-search" placeholder="Search commands…" aria-label="Search launcher commands" />
            </div>
          </Command>
        </Tabs.Content>
      </Tabs.Root>
    </PopoverContent>
  </Popover>
}
