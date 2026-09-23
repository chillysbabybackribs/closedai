import { useState, type JSX } from 'react'
import { Check, ChevronDown, Folder, Plus, X } from 'lucide-react'

import { ProviderMark } from '../components/ui/provider-mark.js'
import type { ChatModel, ChatReasoningEffort } from '../shared/chat.js'
import { ContextUsage, type ContextUsageProps } from './context-meter.js'
import { errorMessage } from './error-message.js'
import { effortLabel, modelMenuDetail, type ProviderSection } from './model-menu-state.js'

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

/**
 * Providers as groups, each opening on its short list — the models used most, the default, the
 * selected one — with a row that reveals the rest. A single provider can be long on its own
 * (dozens of Cursor models against four Codex ones), so the fold is per provider.
 */
export function ModelSection({
  sections,
  selectedModel,
  disabled,
  onChoose
}: {
  sections: ProviderSection[]
  selectedModel: string | null
  disabled: boolean
  onChoose: (modelId: string) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  if (sections.length === 0) {
    return (
      <section className="composer-setup-section" aria-label="Model">
        <SectionLabel>Model</SectionLabel>
        <p className="composer-setup-note">No models are available yet.</p>
      </section>
    )
  }
  return (
    <section className="composer-setup-section" aria-label="Model">
      {sections.map((section) => {
        const shown = expanded.has(section.provider) ? section.all : section.featured
        return (
          <div key={section.provider} className="composer-setup-group">
            <SectionLabel>
              <ProviderMark provider={section.provider} className="composer-setup-label-mark" />
              {section.label}
            </SectionLabel>
            <div role="radiogroup" aria-label={`${section.label} models`}>
              {shown.map((model) => (
                <ModelRow key={model.id} model={model} checked={model.id === selectedModel} disabled={disabled} onChoose={onChoose} />
              ))}
            </div>
            {section.hiddenCount > 0 && !expanded.has(section.provider) && (
              <button
                type="button"
                className="composer-setup-more"
                data-ui="composer.model-more"
                data-ui-key={section.provider}
                onClick={() => setExpanded((current) => new Set([...current, section.provider]))}
              >
                <span>Show {section.hiddenCount} more {section.hiddenCount === 1 ? 'model' : 'models'}</span>
                <ChevronDown aria-hidden="true" />
              </button>
            )}
          </div>
        )
      })}
    </section>
  )
}

function ModelRow({
  model, checked, disabled, onChoose
}: { model: ChatModel; checked: boolean; disabled: boolean; onChoose: (modelId: string) => void }): JSX.Element {
  const detail = modelMenuDetail(model)
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className="composer-setup-item"
      data-ui="composer.model-item"
      data-ui-key={model.id}
      disabled={disabled}
      onClick={() => { if (!checked) onChoose(model.id) }}
    >
      <Check className="composer-setup-check" aria-hidden="true" />
      <span className="composer-setup-item-name">{model.displayName}</span>
      {detail && <span className="composer-setup-item-detail">{detail}</span>}
    </button>
  )
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
    <section className="composer-setup-section" aria-label="Folder">
      <SectionLabel>Folder{pending ? ' · change queued until this chat is idle' : ''}</SectionLabel>
      <div className="composer-setup-item is-current" title={projectPath ?? cwd}>
        <Folder className="composer-setup-item-icon" aria-hidden="true" />
        <span className="composer-setup-item-name">{projectPath ? folderName(projectPath) : 'No project'}</span>
        <span className="composer-setup-item-detail">{projectPath ?? cwd}</span>
      </div>
      {others.map((project) => (
        <button
          key={project.projectPath}
          type="button"
          className="composer-setup-item"
          data-ui="composer.project-recent"
          data-ui-key={project.projectPath}
          title={project.cwd}
          disabled={disabled}
          onClick={() => void choose(() => onSelectProject(project.projectPath))}
        >
          <Folder className="composer-setup-item-icon" aria-hidden="true" />
          <span className="composer-setup-item-name">{folderName(project.projectPath)}</span>
          <span className="composer-setup-item-detail">{project.cwd}</span>
        </button>
      ))}
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
    <section className="composer-setup-section" aria-label="Context and plan usage">
      <SectionLabel>Context</SectionLabel>
      <ContextUsage {...props} />
    </section>
  )
}
