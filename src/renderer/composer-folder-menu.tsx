import { useCallback, useRef, useState, type JSX } from 'react'
import { FolderOpen } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js'

import { FolderSection, folderName } from './composer-setup-sections.js'
import { CAPSULE_PANEL_OFFSET } from './composer-layout.js'

export type ComposerFolderMenuProps = {
  busy: boolean
  cwd: string
  projectPath: string | null
  projectPending?: boolean
  recentProjects: Array<{ cwd: string; projectPath: string }>
  onChooseProject: () => Promise<void>
  onSelectProject: (projectPath: string) => Promise<void>
  onClearProject: () => Promise<void>
  onError: (message: string) => void
}

/** Working-folder control in the composer footer; separate from the model setup popover. */
export function ComposerFolderMenu({
  busy,
  cwd,
  projectPath,
  projectPending = false,
  recentProjects,
  onChooseProject,
  onSelectProject,
  onClearProject,
  onError
}: ComposerFolderMenuProps): JSX.Element | null {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [boundary, setBoundary] = useState<Element | null>(null)
  const [open, setOpen] = useState(false)
  const setOpenState = useCallback((next: boolean): void => {
    setOpen(next)
    if (next) setBoundary(triggerRef.current?.closest('.chat-pane') ?? null)
  }, [])

  const folder = projectPath ? folderName(projectPath) : folderName(cwd)
  const title = `${projectPath ?? cwd}${projectPending ? ' (applies after this chat finishes its current work)' : ''}`

  return (
    <Popover open={open} onOpenChange={setOpenState} modal={false}>
      <PopoverTrigger
        ref={triggerRef}
        type="button"
        className="composer-chip-folder-trigger"
        aria-label="Working folder"
        title={title}
        data-ui="composer.folder"
      >
        <FolderOpen className="composer-chip-folder-icon" size={12} strokeWidth={2.2} aria-hidden="true" />
        <span className="composer-chip-folder-name">
          {folder}{projectPending ? ' (queued)' : ''}
        </span>
      </PopoverTrigger>
      <PopoverContent
        className="composer-setup composer-folder-popover"
        side="top"
        align="end"
        sideOffset={CAPSULE_PANEL_OFFSET}
        collisionPadding={12}
        collisionBoundary={boundary ?? undefined}
        avoidCollisions
        aria-label="Working folder"
      >
        <FolderSection
          cwd={cwd}
          projectPath={projectPath}
          pending={projectPending}
          recentProjects={recentProjects}
          disabled={busy}
          onChooseProject={onChooseProject}
          onSelectProject={onSelectProject}
          onClearProject={onClearProject}
          onError={onError}
        />
      </PopoverContent>
    </Popover>
  )
}
