import type { JSX } from 'react'
import { Folder } from './icons/index.js'

import { sameProjectPath } from '../shared/project-paths.js'
import { folderName } from './composer-setup-sections.js'

export function ChatPaneFolderBar({
  cwd,
  projectPath,
  appCheckoutPath,
  pending,
  disabled,
  onChooseProject
}: {
  cwd: string
  projectPath: string | null
  appCheckoutPath: string | null
  pending: boolean
  disabled: boolean
  onChooseProject: () => Promise<void>
}): JSX.Element {
  const activePath = projectPath ?? cwd
  const onCheckout = appCheckoutPath && sameProjectPath(activePath, appCheckoutPath)
  const label = folderName(activePath)
  const title = appCheckoutPath && !onCheckout
    ? `${activePath}\nApp checkout: ${appCheckoutPath}`
    : activePath
  return (
    <div className="chat-pane-folder-slot">
      <button
        type="button"
        className="chat-pane-folder-trigger"
        data-ui="chat.folder-choose"
        disabled={disabled}
        aria-label={pending ? `Working folder ${label}, change queued` : `Working folder ${label}, choose folder`}
        title={title}
        onClick={() => void onChooseProject()}
      >
        <Folder className="chat-pane-folder-icon" size={14} strokeWidth={2} aria-hidden="true" />
        <span className="chat-pane-folder-name">{label}</span>
        {pending && <span className="chat-pane-folder-pending" aria-hidden="true">· queued</span>}
      </button>
    </div>
  )
}
