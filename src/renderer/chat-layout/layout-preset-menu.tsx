import { useState, type JSX } from 'react'
import { ChevronDown, LayoutGrid } from 'lucide-react'
import { Popover } from 'radix-ui'
import { PresetWireframe } from './layout-presets-dialog.js'
import type { CanvasSize, LayoutPreset } from './layout-presets.js'

const PREVIEW_CANVAS: CanvasSize = { width: 1280, height: 720 }

export const QUICK_LAYOUT_PRESETS: Array<{ key: string; label: string; preset: LayoutPreset }> = [
  { key: 'browser-centre', label: 'Browser centre', preset: { kind: 'browser-centre' } },
  { key: 'six', label: '6 chats', preset: { kind: 'grid', count: 6 } },
  { key: 'four', label: '4 chats', preset: { kind: 'grid', count: 4 } },
  { key: 'browser-side', label: 'Chat + browser', preset: { kind: 'browser-side' } }
]

/** Title-bar control: four one-click workspace layouts plus the full layout dialog. */
export function TitlebarLayoutMenu({
  disabled,
  onApply,
  onOpenPresets
}: {
  disabled?: boolean
  onApply: (preset: LayoutPreset) => void
  onOpenPresets: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Trigger
        type="button"
        className="titlebar-layout-trigger"
        data-ui="layout.preset-menu"
        disabled={disabled}
        aria-label="Workspace layout"
        title="Workspace layout"
      >
        <LayoutGrid size={16} strokeWidth={1.75} aria-hidden="true" />
        <ChevronDown size={12} strokeWidth={2} aria-hidden="true" className="titlebar-layout-chevron" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="titlebar-layout-menu"
          side="bottom"
          align="center"
          sideOffset={6}
          collisionPadding={12}
          aria-label="Quick workspace layouts"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="titlebar-layout-menu-grid" role="group" aria-label="Apply a starting layout">
            {QUICK_LAYOUT_PRESETS.map(({ key, label, preset }) => (
              <button
                key={key}
                type="button"
                className="titlebar-layout-menu-preset"
                data-ui="layout.dock-preset"
                data-ui-key={key}
                title={label}
                aria-label={label}
                onClick={() => {
                  setOpen(false)
                  onApply(preset)
                }}
              >
                <PresetWireframe preset={preset} size={PREVIEW_CANVAS} />
                <span className="titlebar-layout-menu-label">{label}</span>
              </button>
            ))}
          </div>
          <div className="titlebar-layout-menu-divider" aria-hidden="true" />
          <button
            type="button"
            className="titlebar-layout-menu-more"
            data-ui="layout.preset-menu-custom"
            onClick={() => {
              setOpen(false)
              onOpenPresets()
            }}
          >
            Workspace layout…
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
