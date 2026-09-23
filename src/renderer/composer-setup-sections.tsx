import type { JSX } from 'react'
import { Folder, Plus, X } from 'lucide-react'

import type { ChatReasoningEffort } from '../shared/chat.js'
import { ContextUsage, type ContextUsageProps } from './context-meter.js'
import { errorMessage } from './error-message.js'
import { effortLabel } from './model-menu-state.js'

export { ModelSection } from './composer-model-picker.js'

// The sections of the composer's setup panel (composer-setup-menu.tsx). Each is a plain block of
// buttons rather than a Radix menu: the panel is one surface with four kinds of control in it,
// and only the model and effort rows are radios.

export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).at(-1) || path || 'Workspace'
}

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="composer-setup-label">{children}</div>
}

/** Effort as a segmented control: every level visible, one press to change, no submenu. */
export function EffortSection({
  efforts,
  selected,
  disabled,
  onChoose
}: {
  efforts: ChatReasoningEffort[]
  selected: string | null
  disabled: boolean
  onChoose: (effort: string) => void
}): JSX.Element {
  return (
    <section className="composer-setup-section" aria-label="Reasoning effort">
      <SectionLabel>Effort</SectionLabel>
      <div role="radiogroup" className="composer-setup-segment" aria-label="Reasoning effort">
        {efforts.map((option) => {
          const checked = option.reasoningEffort === selected
          return (
            <button
              key={option.reasoningEffort}
              type="button"
              role="radio"
              aria-checked={checked}
              title={option.description || undefined}
              data-ui="composer.effort-item"
              data-ui-key={option.reasoningEffort}
              disabled={disabled}
              onClick={() => { if (!checked) onChoose(option.reasoningEffort) }}
            >
              {effortLabel(option.reasoningEffort)}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** Where the next turn runs: the current folder, the recent ones, and the two ways to change it. */
export function FolderSection({
  cwd,
  projectPath,
  pending,
  recentProjects,
  disabled,
  onChooseProject,
  onSelectProject,
  onClearProject,
  onError
}: {
  cwd: string
  projectPath: string | null
  pending: boolean
  recentProjects: Array<{ cwd: string; projectPath: string }>
  disabled: boolean
  onChooseProject: () => Promise<void>
  onSelectProject: (projectPath: string) => Promise<void>
  onClearProject: () => Promise<void>
  onError: (message: string) => void
}): JSX.Element {
  async function choose(action: () => Promise<void>): Promise<void> {
    try { await action() } catch (reason) { onError(errorMessage(reason, 'Could not change the folder')) }
  }
  const others = recentProjects.filter((project) => project.projectPath !== projectPath)
  return (
    <section className="composer-setup-section composer-folder-section" aria-label="Folder">
      <SectionLabel>Folder{pending ? ' · queued until idle' : ''}</SectionLabel>
      <div className="composer-folder-current" title={projectPath ?? cwd}>
        <Folder className="composer-folder-icon" aria-hidden="true" />
        <span className="composer-folder-name">{projectPath ? folderName(projectPath) : 'No project'}</span>
      </div>
      {others.length > 0 && (
        <div className="composer-folder-recents" aria-label="Recent folders">
          {others.map((project) => (
            <button
              key={project.projectPath}
              type="button"
              className="composer-folder-chip"
              data-ui="composer.project-recent"
              data-ui-key={project.projectPath}
              title={project.cwd}
              disabled={disabled}
              onClick={() => void choose(() => onSelectProject(project.projectPath))}
            >
              {folderName(project.projectPath)}
            </button>
          ))}
        </div>
      )}
      <div className="composer-setup-actions">
        <button
          type="button"
          className="composer-setup-action"
          data-ui="composer.project-new"
          disabled={disabled}
          onClick={() => void choose(onChooseProject)}
        >
          <Plus aria-hidden="true" />
          Choose folder…
        </button>
        <button
          type="button"
          className="composer-setup-action"
          data-ui="composer.project-clear"
          disabled={disabled || !projectPath}
          onClick={() => void choose(onClearProject)}
        >
          <X aria-hidden="true" />
          Don’t work in a project
        </button>
      </div>
    </section>
  )
}

/** Context window and plan usage, plus manual compaction when the provider offers it. */
export function ContextSection(props: ContextUsageProps): JSX.Element {
  return (
    <details className="composer-setup-section composer-setup-details">
      <summary className="composer-setup-details-summary">Context & plan</summary>
      <ContextUsage {...props} />
    </details>
  )
}
