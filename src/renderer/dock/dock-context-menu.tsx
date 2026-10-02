import { useState, type JSX, type ReactElement } from 'react'
import { ContextMenu } from 'radix-ui'
import { ChevronRight, Pin, PinOff } from 'lucide-react'
import { DOCK_ICON_OPTIONS, isDockIconPinned, type DockIconId, type DockPrefs } from './dock-model.js'

/** One menu for dock icons and its empty backing; provider and window controls opt out. */
export function DockContextMenu({ children, prefs, onPin, onOpenChange }: {
  children: ReactElement
  prefs: DockPrefs
  onPin: (id: DockIconId, pinned: boolean) => void
  onOpenChange: (open: boolean) => void
}): JSX.Element {
  const [target, setTarget] = useState<DockIconId | null>(null)
  const available = DOCK_ICON_OPTIONS.filter(({ id }) => !isDockIconPinned(prefs, id))
  return <ContextMenu.Root onOpenChange={onOpenChange}>
    <ContextMenu.Trigger asChild onContextMenu={(event) => {
      const element = event.target instanceof Element ? event.target : null
      const id = element?.closest('[data-dock-icon]')?.getAttribute('data-dock-icon')
      const icon = DOCK_ICON_OPTIONS.find((option) => option.id === id)
      // The provider marks share a button. They must not inherit the dock's pin menu.
      if (!icon && element?.closest('button, [role="menu"], [role="dialog"]')) {
        event.preventDefault()
        return
      }
      setTarget(icon?.id ?? null)
    }}>
      {children}
    </ContextMenu.Trigger>
    <ContextMenu.Portal>
      <ContextMenu.Content className="titlebar-menu-content" collisionPadding={8} loop>
        {target && <>
          <ContextMenu.Item className="titlebar-menu-item" data-ui="dock.unpin" data-ui-key={target}
            onSelect={() => onPin(target, false)}>
            <span className="flex items-center gap-2"><PinOff size={16} aria-hidden="true" />Unpin from dock</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className="titlebar-menu-separator" />
        </>}
        <ContextMenu.Sub>
          <ContextMenu.SubTrigger className="titlebar-menu-item" data-ui="dock.add-menu" disabled={available.length === 0}>
            <span className="flex items-center gap-2"><Pin size={16} aria-hidden="true" />Add to dock</span>
            <ChevronRight size={14} aria-hidden="true" />
          </ContextMenu.SubTrigger>
          <ContextMenu.Portal>
            <ContextMenu.SubContent className="titlebar-menu-content" collisionPadding={8}>
              {available.map(({ id, label }) => <ContextMenu.Item key={id} className="titlebar-menu-item"
                data-ui="dock.pin" data-ui-key={id} onSelect={() => onPin(id, true)}>{label}</ContextMenu.Item>)}
            </ContextMenu.SubContent>
          </ContextMenu.Portal>
        </ContextMenu.Sub>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  </ContextMenu.Root>
}
