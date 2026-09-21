import type { JSX, ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

export type DisclosureRowProps = {
  /** Row id, surfaced to automation as the control's item. */
  id: string
  /** The manifest control id of the expander, written literally at the call site. */
  control: string
  label: ReactNode
  /** A small dot beside the name: red for something broken, amber for something worth a look. */
  flag?: 'bad' | 'warn' | null
  /** Short text at the right of the line; empty when there is nothing to say. */
  note?: string
  noteTone?: 'bad' | 'warn' | null
  /** Controls at the far right: a switch, a date, a quiet action. */
  trailing?: ReactNode
  /** Dimmed presentation for an off or inactive row. */
  muted?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The panel that drops down under the line while open. */
  children?: ReactNode
}

/**
 * One line that opens into a panel: the list pattern the app's dialogs share. A row is a name
 * and, at most, one control; everything else waits in the panel until the row is clicked.
 */
export function DisclosureRow({
  id,
  control,
  label,
  flag = null,
  note = '',
  noteTone = null,
  trailing,
  muted = false,
  open,
  onOpenChange,
  children
}: DisclosureRowProps): JSX.Element {
  return (
    <li className="disclosure-row" data-open={open} data-muted={muted}>
      <div className="disclosure-row-line">
        <button
          type="button"
          className="disclosure-row-open"
          aria-expanded={open}
          data-ui={control}
          data-ui-key={id}
          onClick={() => onOpenChange(!open)}
        >
          <ChevronRight size={13} className="disclosure-row-chevron" aria-hidden="true" />
          <span className="disclosure-row-name">{label}</span>
          {flag ? <span className="disclosure-row-flag" data-tone={flag} aria-hidden="true" /> : null}
        </button>
        <span className="disclosure-row-note" data-tone={noteTone ?? undefined}>{note}</span>
        <span className="disclosure-row-trailing">{trailing}</span>
      </div>
      {open ? <div className="disclosure-row-panel">{children}</div> : null}
    </li>
  )
}
