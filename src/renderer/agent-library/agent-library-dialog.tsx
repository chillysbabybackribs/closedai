import type { JSX } from 'react'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog.js'
import type { SavedAgent, SavedAgentDraft } from '../../shared/agent-library.js'
import type { AgentRunStartOptions } from '../../shared/agent-runs.js'
import { AgentLibraryPanel } from './agent-library-panel.js'
import { useAgentLibrary } from './agent-library-store.js'

export type AgentLibraryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  startEnabled: boolean
  /** Docks a new chat beside the launching pane and starts the run on it. */
  onStart: (options: AgentRunStartOptions) => Promise<void>
}

/** The Agents dialog: opened from the composer's Agent button or Agent → Agents… on the selected pane. */
export function AgentLibraryDialog({ open, onOpenChange, startEnabled, onStart }: AgentLibraryDialogProps): JSX.Element {
  const agents = useAgentLibrary()
  const save = async (draft: SavedAgentDraft, id: string | null): Promise<SavedAgent> => {
    // An entry deleted elsewhere while it sat in the editor is saved again as a new one.
    const updated = id ? await window.closedai.agentLibrary.update(id, draft) : null
    return updated ?? window.closedai.agentLibrary.save(draft)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="agent-library-dialog" aria-describedby="agent-library-description" data-ui="dialog.agents">
        <header className="shrink-0 border-b px-6 py-3.5 pr-14">
          <DialogTitle className="text-base font-semibold">Agents</DialogTitle>
          <DialogDescription id="agent-library-description" className="text-muted-foreground text-sm">
            Standing instructions the app keeps driving cycle after cycle. Start opens a new chat beside this one with its model and folder.
          </DialogDescription>
        </header>
        {open && (
          <AgentLibraryPanel
            agents={agents}
            now={Date.now()}
            startEnabled={startEnabled}
            onSave={save}
            onRemove={(id) => window.closedai.agentLibrary.remove(id)}
            onStart={async (options) => {
              await onStart(options)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
