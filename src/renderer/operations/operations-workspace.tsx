import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  CircleAlert
} from 'lucide-react'
import { NewWorkerDialog } from './new-worker-dialog.js'
import {
  attentionRunCount,
  INITIAL_RUNS,
  type OperationsRun,
  type RunStatus
} from './operations-data.js'
import { OperationsHeader, type OperationsView } from './operations-sidebar.js'
import { OperationsViewContent } from './operations-views.js'
import { RunDetailDrawer } from './run-detail-drawer.js'
import { RunsTable } from './runs-table.js'
import { WorkerChatDrawer } from './worker-chat-drawer.js'
import type { ChatModel } from '../../shared/chat.js'
import type { OperationsEvent } from '../../shared/operations.js'

export function OperationsWorkspace({ onAttentionCountChange }: { onAttentionCountChange?: (count: number) => void } = {}): JSX.Element {
  const operationsApi = typeof window.closedai === 'undefined' ? null : window.closedai.operations
  const [runs, setRuns] = useState<OperationsRun[]>(INITIAL_RUNS)
  const [models, setModels] = useState<ChatModel[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [modelError, setModelError] = useState('')
  const [view, setView] = useState<OperationsView>('overview')
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [newWorkerOpen, setNewWorkerOpen] = useState(false)
  const selectedRun = selectedRunId === null ? null : runs.find((run) => run.id === selectedRunId) ?? null

  useEffect(() => {
    onAttentionCountChange?.(attentionRunCount(runs))
  }, [onAttentionCountChange, runs])

  useEffect(() => {
    if (!operationsApi) return undefined
    let active = true
    const apply = (event: OperationsEvent): void => {
      if (active) setRuns(event.runs)
    }
    const unsubscribe = operationsApi.onChanged(apply)
    void operationsApi.snapshot().then((snapshot) => {
      if (active) setRuns(snapshot.runs)
    }).catch(() => {})
    return () => { active = false; unsubscribe() }
  }, [operationsApi])

  useEffect(() => {
    if (!newWorkerOpen) return undefined
    if (!operationsApi) return undefined
    let active = true
    void operationsApi.models().then((catalog) => {
      if (!active) return
      setModelError('')
      setModels(catalog.models)
      setSelectedModel(catalog.selectedModel ?? catalog.models[0]?.id ?? null)
    }).catch((reason) => {
      if (!active) return
      setModels([])
      setSelectedModel(null)
      setModelError(reason instanceof Error ? reason.message : 'Could not load models from Codex.')
    })
    return () => { active = false }
  }, [newWorkerOpen, operationsApi])

  function updateSelectedStatus(status: RunStatus): void {
    if (selectedRunId === null) return
    if (operationsApi) {
      void operationsApi.setStatus(selectedRunId, status).catch(() => {})
    }
  }

  function changeView(nextView: OperationsView): void {
    setView(nextView)
    setSelectedRunId(null)
    setChatOpen(false)
  }

  async function createWorker(task: string, workspace: string, modelId: string): Promise<void> {
    if (operationsApi) {
      const run = await operationsApi.create(task, workspace, modelId)
      setTab('all')
      setSearch('')
      setNewWorkerOpen(false)
      setSelectedRunId(run.id)
      return
    }
    throw new Error('Open the ClosedAI desktop app to run a worker with a live Codex model.')
  }

  return (
    <section className="operations-workspace" data-ui-surface="operations">
      <OperationsHeader runs={runs} />
      <main className="ops-main">
        <OperationsViewContent
          view={view}
          runs={runs}
          onNewWorker={() => setNewWorkerOpen(true)}
          onOpenRun={setSelectedRunId}
        />
      </main>
      {selectedRun ? (
        <RunDetailDrawer
          run={selectedRun}
          onClose={() => setSelectedRunId(null)}
          onMessage={() => setChatOpen(true)}
          onStatusChange={updateSelectedStatus}
          interactive={Boolean(operationsApi)}
          escapeEnabled={!chatOpen}
        />
      ) : null}
      {chatOpen && selectedRun ? <WorkerChatDrawer run={selectedRun} onClose={() => setChatOpen(false)} /> : null}
      {newWorkerOpen ? (
        <NewWorkerDialog
          onClose={() => setNewWorkerOpen(false)}
          onCreate={createWorker}
          models={models}
          defaultModel={selectedModel}
          modelsMessage={operationsApi
            ? modelError || 'No models are available from Codex.'
            : 'Open the ClosedAI desktop app to run a worker with a live Codex model.'}
        />
      ) : null}
    </section>
  )
}
