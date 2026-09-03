import type { JSX } from 'react'
import { DropdownMenu } from 'radix-ui'
import { Activity, Check, Folder, Plus, Wrench, X } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import { TurnActivityIndicator } from './task-activity.js'

type ProjectMenuProps = {
  cwd: string
  projectPath: string | null
  recentProjects: Array<{ cwd: string; projectPath: string }>
  disabled: boolean
  onChooseProject: () => Promise<void>
  onSelectProject: (projectPath: string) => Promise<void>
  onClearProject: () => Promise<void>
  onOpenTools: () => void
  onOpenTrace: () => void
  /** Turn in flight, if any; drives the working timer on the left of the rail. */
  activeTurnId: string | null
}

function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).at(-1) || path || 'Workspace'
}

/** Project context lives with the composer because it determines where the next turn runs. */
export function ProjectMenu({
  cwd, projectPath, recentProjects, disabled, onChooseProject, onSelectProject, onClearProject, onOpenTools, onOpenTrace, activeTurnId
}: ProjectMenuProps): JSX.Element {
  const label = projectPath ? folderName(projectPath) : 'No project'

  return (
    <div className="composer-project-strip">
      <TurnActivityIndicator activeTurnId={activeTurnId} />
      <span className="composer-project-strip-spacer" />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="composer-project-trigger"
            aria-label="Choose project"
            data-ui="composer.project"
            disabled={disabled}
            title={projectPath ?? cwd}
          >
            <Folder size={18} aria-hidden="true" />
            <span>{label}</span>
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="composer-project-menu" side="top" align="end" sideOffset={8}>
            {projectPath && (
              <DropdownMenu.Item className="composer-project-current" disabled>
                <Folder size={17} aria-hidden="true" />
                <span>{folderName(projectPath)}</span>
                <Check size={16} aria-hidden="true" />
              </DropdownMenu.Item>
            )}
            {recentProjects.length > 0 && <>
              <DropdownMenu.Separator className="composer-project-menu-separator" />
              <div className="composer-project-menu-label">Recent projects</div>
              {recentProjects.map((project) => (
                <DropdownMenu.Item
                  key={project.projectPath}
                  className="composer-project-recent"
                  data-ui="composer.project-recent"
                  data-ui-key={project.projectPath}
                  title={project.cwd}
                  onSelect={() => void onSelectProject(project.projectPath)}
                >
                  <Folder size={17} aria-hidden="true" />
                  <span>{folderName(project.projectPath)}</span>
                  <small>{project.cwd}</small>
                </DropdownMenu.Item>
              ))}
            </>}
            <DropdownMenu.Item
              className="composer-project-item"
              data-ui="composer.project-new"
              onSelect={() => void onChooseProject()}
            >
              <Plus size={18} aria-hidden="true" />
              <span>New project</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="composer-project-item"
              data-ui="composer.project-clear"
              disabled={!projectPath}
              onSelect={() => void onClearProject()}
            >
              <X size={18} aria-hidden="true" />
              <span>Don’t work in a project</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Button type="button" variant="ghost" className="composer-strip-action" data-ui="composer.tools" onClick={onOpenTools}>
        <Wrench size={16} aria-hidden="true" />
        <span>Tools</span>
      </Button>
      <Button type="button" variant="ghost" className="composer-strip-action" data-ui="composer.trace" onClick={onOpenTrace}>
        <Activity size={16} aria-hidden="true" />
        <span>Turn trace</span>
      </Button>
    </div>
  )
}
