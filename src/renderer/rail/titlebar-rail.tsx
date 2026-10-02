import type { JSX } from 'react'

/** A flat menu rail; chat-card search fields do not shape the window chrome. */
export function TitlebarRail(): JSX.Element {
  return <div aria-hidden="true" className="titlebar-rail">
    <div data-slot="titlebar-rail-fill" />
  </div>
}
