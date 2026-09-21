import type { JSX } from 'react'

import type { ChatConnection } from '../shared/chat.js'

/**
 * What the workspace area shows before the first snapshot names a pane: a startup notice, or the
 * reason the snapshot failed with a way to ask again. Without it a slow or failed main process
 * left the window empty below the title bar.
 */
export function AppStartup({ connection, onRetry }: {
  connection: ChatConnection
  onRetry: () => void
}): JSX.Element {
  if (connection.state !== 'error') {
    return (
      <div className="shell-startup" role="status" data-ui-surface="shell-startup">
        <p>Starting ClosedAI…</p>
      </div>
    )
  }
  return (
    <div className="shell-startup" role="alert" data-ui-surface="shell-startup">
      <h1>Could not start</h1>
      <p>{connection.message}</p>
      <button type="button" className="shell-startup-action" onClick={onRetry}>Retry</button>
    </div>
  )
}
