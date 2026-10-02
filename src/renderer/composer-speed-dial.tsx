import { useEffect, useId, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { Plus } from 'lucide-react'

type ComposerAction = {
  id: string
  item?: string
  label: string
  icon: ReactNode
  disabled?: boolean
  run: () => void
}

/** A right-opening action rail; adding an action preserves its keyboard and dismissal behavior. */
export function ComposerSpeedDial({ actions }: { actions: ComposerAction[] }): JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const close = (): void => { setOpen(false); trigger.current?.focus() }

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const dismiss = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  return <div ref={root} className="composer-speed-dial" data-open={open || undefined}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); return }
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      if (!open) { setOpen(true); return }
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      if (!items.length) return
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
      items[index]?.focus()
    }}>
    <button ref={trigger} type="button" className="composer-tool composer-speed-trigger" data-ui="composer.more"
      aria-label={open ? 'Close composer actions' : 'Open composer actions'} title="Composer actions"
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen((value) => !value)}>
      <Plus size={19} strokeWidth={1.9} aria-hidden="true" />
    </button>
    {open && <div ref={menu} id={menuId} className="composer-speed-actions" role="menu" aria-label="Composer actions" aria-orientation="horizontal">
      {actions.map((action, index) => <button key={action.id} type="button" role="menuitem"
        className="composer-tool composer-speed-item" style={{ '--action-index': index } as CSSProperties}
        data-ui={action.id} data-ui-key={action.item} aria-label={action.label} title={action.label}
        disabled={action.disabled} onClick={() => { close(); action.run() }}>
        {action.icon}
      </button>)}
    </div>}
  </div>
}
