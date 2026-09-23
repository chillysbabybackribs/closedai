import type { JSX } from 'react'
import { ChevronRight, Folder, Plus, X } from 'lucide-react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible.js'
import { Progress } from '../components/ui/progress.js'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group.js'
import { cn } from '../lib/utils.js'
import type { ChatReasoningEffort } from '../shared/chat.js'
import { contextLevel, ContextUsage, type ContextUsageProps } from './context-meter.js'
import { errorMessage } from './error-message.js'
import { effortLabel, modelContextLabel } from './model-menu-state.js'

// The sections around the model list in the composer's setup panel (composer-setup-menu.tsx),
// and the folder panel's one section (composer-folder-menu.tsx).

export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).at(-1) || path || 'Workspace'
}

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="composer-setup-label">{children}</div>
}

/**
 * Effort as a segmented control: every level visible, one press to change, no submenu. A model
 * without levels keeps the row's height with a line saying who sets it, so Recent below never
 * jumps when the selection changes.
 */
export function EffortSection({
  efforts,
  selected,
  disabled,
  note,
  providerLabel,
  onChoose
}: {
  efforts: ChatReasoningEffort[]
  selected: string | null
  disabled: boolean
  /** Why the control is locked, when it is. */
  note?: string | null
  providerLabel: string
  onChoose: (effort: string) => void
}): JSX.Element {
  return (
    <section className="shrink-0 border-t border-border px-3 pt-2.5 pb-3" aria-label="Reasoning effort">
      <div className="mb-1.5 flex items-center text-xs text-muted-foreground">
        Effort
        {note && <span className="ml-auto">{note}</span>}
      </div>
      {efforts.length > 0 ? (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={selected ?? ''}
          onValueChange={(next) => { if (next && next !== selected) onChoose(next) }}
          disabled={disabled}
          aria-label="Reasoning effort"
          className="w-full"
        >
          {efforts.map((option) => (
            <ToggleGroupItem
              key={option.reasoningEffort}
              value={option.reasoningEffort}
              title={option.description || undefined}
              data-ui="composer.effort-item"
              data-ui-key={option.reasoningEffort}
              className="h-7 flex-1 px-1 text-xs"
            >
              {effortLabel(option.reasoningEffort)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : (
        <p className="flex h-7 items-center text-xs text-muted-foreground">Set by {providerLabel} for this model</p>
      )}
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

/**
 * Context and plan usage as one glanceable line at the far end of the popover from the trigger,
 * opening onto the full usage card and manual compaction.
 */
export function ContextSection(props: ContextUsageProps): JSX.Element {
  const { usage, planUsage, modelContext } = props
  const window = planUsage?.windows[0]
  const of = usage ? modelContextLabel(usage.contextWindow) : modelContext
  return (
    <Collapsible className="shrink-0 border-b border-border">
      <CollapsibleTrigger
        data-ui="composer.context"
        className="group flex w-full flex-col gap-1.5 px-3 pt-2.5 pb-2 text-left text-xs text-muted-foreground outline-none hover:bg-accent/40 focus-visible:bg-accent/40"
      >
        <span className="flex w-full items-center">
          Context
          <span className="ml-1.5 tabular-nums text-foreground">{usage ? modelContextLabel(usage.usedTokens) ?? '0' : '—'}</span>
          {of && <span className="ml-1">of {of}</span>}
          {window && <span className="ml-auto tabular-nums">{window.label} {window.percent}%</span>}
          <ChevronRight className={cn('size-3.5 transition-transform group-data-[state=open]:rotate-90', window ? 'ml-1' : 'ml-auto')} aria-hidden="true" />
        </span>
        <Progress value={usage?.percent ?? 0} data-level={contextLevel(usage?.percent ?? 0)} className="h-1 bg-[var(--surface-control)]" />
      </CollapsibleTrigger>
      <CollapsibleContent className="max-h-56 overflow-y-auto px-3 pb-2">
        <ContextUsage {...props} />
      </CollapsibleContent>
    </Collapsible>
  )
}
