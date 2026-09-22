import { useEffect, useState, type JSX } from 'react'
import { Switch } from '../../components/ui/switch.js'
import { ProviderMark } from '../../components/ui/provider-mark.js'
import { cn } from '../../lib/utils.js'
import type { ChatProvider } from '../../shared/chat.js'
import { useModelsController } from './models-settings.js'

export type ModelsPanelProps = {
  active: boolean
}

function formatContext(tokens: number | undefined): string | null {
  if (!tokens || tokens <= 0) return null
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M context`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K context`
  return `${tokens} context`
}

/**
 * Settings → Models: choose which account models appear in the composer picker, grouped by
 * connected provider — the same per-provider toggles Cursor exposes in its model settings.
 */
export function ModelsPanel({ active }: ModelsPanelProps): JSX.Element {
  const models = useModelsController(active, window.closedai?.models)
  const sections = models.manifest?.providers ?? []
  const [providerId, setProviderId] = useState<ChatProvider>('codex')
  const activeSection = sections.find((section) => section.provider === providerId) ?? sections[0] ?? null

  useEffect(() => {
    if (!active || sections.length === 0) return
    if (!sections.some((section) => section.provider === providerId)) setProviderId(sections[0]!.provider)
  }, [active, sections, providerId])

  const enabledInSection = activeSection?.models.filter((row) => row.enabled).length ?? 0

  return (
    <div className="settings-panel models-panel" data-ui="dialog.models">
      {models.error ? <p className="models-error" role="alert">{models.error}</p> : null}
      {!models.manifest ? (
        <p className="models-empty">Loading models…</p>
      ) : sections.length === 0 ? (
        <p className="models-empty">
          Connect to a provider and wait for its catalog to load, then return here to choose which models appear in the picker.
        </p>
      ) : (
        <div className="models-split">
          <nav className="models-rail" aria-label="Providers">
            {sections.map((section) => {
              const on = section.models.filter((row) => row.enabled).length
              const selected = section.provider === (activeSection?.provider ?? providerId)
              return (
                <button
                  key={section.provider}
                  type="button"
                  className={cn('models-rail-item', selected && 'models-rail-item-active')}
                  data-ui="settings.models-provider"
                  data-ui-key={section.provider}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => setProviderId(section.provider)}
                >
                  <ProviderMark provider={section.provider} className="models-rail-mark" />
                  <span className="models-rail-copy">
                    <span className="models-rail-title">{section.label}</span>
                    <span className="models-rail-meta">{on}/{section.models.length} on</span>
                  </span>
                </button>
              )
            })}
          </nav>
          <div className="models-pane">
            {activeSection ? (
              <>
                <header className="models-pane-head">
                  <div>
                    <h3 className="models-pane-title">{activeSection.label}</h3>
                    <p className="models-pane-sub">
                      {enabledInSection} of {activeSection.models.length} models shown in the composer menu
                    </p>
                  </div>
                </header>
                <ul className="models-list">
                  {activeSection.models.map((row) => {
                    const context = formatContext(row.model.contextWindow)
                    return (
                      <li key={row.model.id} className="models-row">
                        <div className="models-row-copy">
                          <span className="models-row-name">{row.model.displayName}</span>
                          {context ? <span className="models-row-meta">{context}</span> : null}
                        </div>
                        <Switch
                          checked={row.enabled}
                          aria-label={`Show ${row.model.displayName} in the model menu`}
                          data-ui="settings.models-toggle"
                          data-ui-key={row.model.id}
                          onCheckedChange={(checked) => { void models.setEnabled(row.model.id, checked) }}
                        />
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      )}
      <div className="appearance-dialog-footer models-footer">
        <span>{models.error ? 'Changes may not have saved' : 'Changes are saved automatically'}</span>
      </div>
    </div>
  )
}
