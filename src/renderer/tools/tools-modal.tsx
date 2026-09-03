import type { JSX } from 'react'
import { useMemo } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'

import { Button } from '../../components/ui/button.js'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog.js'
import type { ToolInfo, ToolStats } from '../../shared/tools.js'
import { ToolCard, type ToolCardItem } from './tool-card.js'
import { useToolsController } from './tools-controller.js'

export type ToolsModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Every capability the app offers a model, one card each, with an on/off switch and usage.
 * The user's view: an action tool's verbs are separate cards, grouped under the tool the
 * model actually sees.
 */
export function ToolsModal({ open, onOpenChange }: ToolsModalProps): JSX.Element {
  const tools = useToolsController(open)
  const groups = useMemo(
    () => (tools.manifest?.namespaces.flatMap((namespace) => namespace.tools) ?? [])
      .map((tool) => ({ tool, items: cardItems(tool, tools.telemetry?.stats ?? []) })),
    [tools.manifest, tools.telemetry]
  )
  const items = groups.flatMap((group) => group.items)
  const enabledCount = items.filter((item) => item.enabled).length
  const totalCalls = tools.telemetry?.totalCalls ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tools-modal" aria-describedby="tools-modal-description" data-ui="dialog.tools">
        <header className="tools-modal-header">
          <div>
            <DialogTitle>Tools</DialogTitle>
            <DialogDescription id="tools-modal-description">
              {tools.manifest
                ? `${enabledCount} of ${items.length} on · advertised to ${tools.manifest.providers.join(', ') || 'no provider'} · ${totalCalls} run${totalCalls === 1 ? '' : 's'} recorded`
                : 'Loading…'}
            </DialogDescription>
          </div>
          <div className="tools-modal-header-actions">
            <Button type="button" variant="ghost" size="sm" data-ui="tools.refresh" onClick={() => void tools.refresh()}>
              <RefreshCw aria-hidden="true" /> Refresh
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={totalCalls === 0} data-ui="tools.clear" onClick={() => void tools.clearTelemetry()}>
              <Trash2 aria-hidden="true" /> Clear counts
            </Button>
          </div>
        </header>

        {tools.error && <p className="tools-modal-error" role="alert">{tools.error}</p>}

        <div className="tools-modal-list">
          {groups.map(({ tool, items: cards }) => (
            <section key={tool.id} className="tools-modal-group" aria-label={tool.id}>
              <h3 className="tools-modal-group-title">
                <span className="tools-modal-group-name"><span className="tool-card-namespace">{tool.namespace}.</span>{tool.name}</span>
                <span className="tools-modal-group-meta">
                  {tool.actions.length > 0 ? `${cards.filter((card) => card.enabled).length} of ${cards.length} on · one tool to the model` : 'plain tool'}
                </span>
              </h3>
              <ul className="tools-modal-cards">
                {cards.map((item) => (
                  <ToolCard key={item.id} item={item} onToggle={(enabled) => void tools.setEnabled(item.id, enabled)} />
                ))}
              </ul>
            </section>
          ))}
          {tools.manifest && groups.length === 0 && <p className="tools-modal-empty">No tools are registered.</p>}
        </div>

        <footer className="tools-modal-footer">
          Switching something off refuses its calls immediately and drops it from what new chats are offered. A chat that is already open keeps its tool list until the next chat.
        </footer>
      </DialogContent>
    </Dialog>
  )
}

/** One card per action of an action tool; one card for a plain tool. */
function cardItems(tool: ToolInfo, stats: ToolStats[]): ToolCardItem[] {
  if (tool.actions.length === 0) {
    return [{
      id: tool.id,
      name: tool.name,
      enabled: tool.enabled,
      stat: stats.find((stat) => stat.toolId === tool.id && stat.action === null) ?? null
    }]
  }
  return tool.actions.map((action) => ({
    id: action.id,
    name: action.name,
    enabled: action.enabled,
    stat: stats.find((stat) => stat.toolId === tool.id && stat.action === action.name) ?? null
  }))
}
