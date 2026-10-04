import { Check } from '../icons/index.js'
import { DropdownMenu } from 'radix-ui'
import { useCallback, useState, type MouseEvent, type ReactNode } from 'react'
import {
  BACKDROP_PRESET_IDS,
  BACKDROP_PRESET_LABELS,
  type WorkspaceBackdrop
} from '../../shared/backdrop-presets.js'

export type WorkspaceBackdropMenuProps = {
  backdrop: WorkspaceBackdrop
  onBackdropChange: (mode: WorkspaceBackdrop) => void
  /** Open the full picker: uploads, previews and the current wallpaper. */
  onOpenWallpaper: () => void
}

/** Menu body for the workspace background picker (right-click on empty canvas). */
export function WorkspaceBackdropMenuItems({ backdrop, onBackdropChange, onOpenWallpaper }: WorkspaceBackdropMenuProps): ReactNode {
  return <>
    <BackdropMenuRow label="Off" checked={backdrop === 'off'} data-ui="workspace.backdrop" data-ui-key="off"
      onSelect={() => onBackdropChange('off')} />
    <BackdropMenuRow label="Desktop wallpaper" checked={backdrop === 'desktop'} data-ui="workspace.backdrop" data-ui-key="desktop"
      onSelect={() => onBackdropChange('desktop')} />
    <DropdownMenu.Separator className="titlebar-menu-separator" />
    {BACKDROP_PRESET_IDS.map((id) => {
      const value = `preset:${id}` as const
      return <BackdropMenuRow key={id} label={BACKDROP_PRESET_LABELS[id]} checked={backdrop === value}
        data-ui="workspace.backdrop" data-ui-key={id}
        onSelect={() => onBackdropChange(value)} />
    })}
    <DropdownMenu.Separator className="titlebar-menu-separator" />
    <BackdropMenuRow label="Change wallpaper…" checked={false} data-ui="workspace.wallpaper" data-ui-key="open"
      onSelect={onOpenWallpaper} />
  </>
}

/**
 * Right-click on the empty canvas itself (not a tile inside it) opens the picker at the pointer.
 * Returns the context-menu handler and the anchored menu to render beside the canvas.
 */
export function useWorkspaceBackdropContextMenu({ backdrop, onBackdropChange, onOpenWallpaper }: WorkspaceBackdropMenuProps): {
  openBackdropMenu: (event: MouseEvent<HTMLElement>) => void
  backdropMenu: ReactNode
} {
  const [open, setOpen] = useState(false)
  const [point, setPoint] = useState({ x: 0, y: 0 })
  const openBackdropMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    setPoint({ x: event.clientX, y: event.clientY })
    setOpen(true)
  }, [])
  const backdropMenu = <DropdownMenu.Root open={open} onOpenChange={setOpen} modal>
    <DropdownMenu.Trigger asChild>
      <span className="workspace-backdrop-menu-anchor"
        style={{ left: point.x, top: point.y }} aria-hidden="true" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="titlebar-menu-content chat-layout-context-menu"
        side="bottom" align="start" sideOffset={0} collisionPadding={8}
        onCloseAutoFocus={(event) => event.preventDefault()}>
        <WorkspaceBackdropMenuItems backdrop={backdrop} onBackdropChange={(mode) => {
          onBackdropChange(mode)
          setOpen(false)
        }} onOpenWallpaper={onOpenWallpaper} />
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
  return { openBackdropMenu, backdropMenu }
}

function BackdropMenuRow({ label, checked, onSelect, ...rest }: {
  label: string
  checked: boolean
  onSelect: () => void
  'data-ui': string
  'data-ui-key': string
}): ReactNode {
  return <DropdownMenu.Item className="titlebar-menu-item chat-layout-menu-item" onSelect={onSelect} {...rest}>
    <div className="chat-layout-menu-item-main">
      <div className="chat-layout-menu-item-left">
        <span>{label}</span>
      </div>
    </div>
    {checked && <span className="titlebar-menu-shortcut"><Check size={14} aria-hidden="true" /></span>}
  </DropdownMenu.Item>
}
