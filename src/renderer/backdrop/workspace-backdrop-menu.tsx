import { Check } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import type { ReactNode } from 'react'
import {
  BACKDROP_PRESET_IDS,
  BACKDROP_PRESET_LABELS,
  type WorkspaceBackdrop
} from '../../shared/backdrop-presets.js'

export type WorkspaceBackdropMenuProps = {
  backdrop: WorkspaceBackdrop
  onBackdropChange: (mode: WorkspaceBackdrop) => void
}

/** Menu body for the workspace background picker (right-click on empty canvas). */
export function WorkspaceBackdropMenuItems({ backdrop, onBackdropChange }: WorkspaceBackdropMenuProps): ReactNode {
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
  </>
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
