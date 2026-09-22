import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { Button } from '../../components/ui/button.js'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js'
import { Input } from '../../components/ui/input.js'
import { ProviderMark } from '../../components/ui/provider-mark.js'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.js'
import { cn } from '../../lib/utils.js'
import {
  HIVE_RUNS,
  HIVE_UNITS,
  HIVE_WORKERS,
  PROVIDER_CAPACITY,
  type HiveUnit
} from './hive-fixture.js'
import { RunStatusPill, StepStatePill } from './hive-pills.js'

type RunView = 'pulse' | 'workers' | 'signal' | 'gates'
type DetailView = 'step' | 'steer' | 'artifacts'

const STAGE_LABELS = {
  queued: 'Waiting',
  running: 'Active',
  review: 'Verify',
  done: 'Complete'
} as const

function FlowGraph(): JSX.Element {
  return (
    <svg viewBox="0 0 260 280" className="w-full max-h-[260px]" aria-hidden>
      <rect x="95" y="8" width="70" height="28" rx="6" fill="var(--secondary)" stroke="var(--antigravity-blue, #8ab4f8)" />
      <text x="130" y="26" textAnchor="middle" fill="var(--foreground)" fontSize="10">Run plan</text>
      <rect x="88" y="232" width="84" height="28" rx="6" fill="var(--secondary)" stroke="#65b98a" />
      <text x="130" y="250" textAnchor="middle" fill="var(--foreground)" fontSize="10">Release gate</text>
    </svg>
  )
}

type HiveRunViewProps = {
  runTitle: string
  onNewRun: () => void
}

export function HiveRunView({ runTitle, onNewRun }: HiveRunViewProps): JSX.Element {
  const [activeRunId, setActiveRunId] = useState(HIVE_RUNS[0]!.id)
  const [mainView, setMainView] = useState<RunView>('pulse')
  const [detailView, setDetailView] = useState<DetailView>('step')
  const [selectedStepId, setSelectedStepId] = useState('u-41')
  const selectedStep = useMemo(() => HIVE_UNITS.find((u) => u.id === selectedStepId) ?? HIVE_UNITS[2]!, [selectedStepId])

  const stepsByStage = useMemo(() => {
    const map: Record<HiveUnit['column'], HiveUnit[]> = { queued: [], running: [], review: [], done: [] }
    for (const unit of HIVE_UNITS) map[unit.column].push(unit)
    return map
  }, [])

  return (
    <div className="hive-workstation hive-workstation--live" data-ui="hive.workstation">
      <header className="hive-workstation__bar">
        <span className="hive-workstation__bar-brand">ClosedAI</span>
        <span>Hive</span>
        <span className="hive-workstation__bar-crumb">{runTitle}</span>
        <span className="hive-workstation__pill hive-workstation__pill--run">Live</span>
        <span className="hive-workstation__bar-spacer" />
        <Button type="button" variant="ghost" size="sm" data-ui="hive.run.new" onClick={onNewRun}>New run</Button>
        <Button type="button" variant="secondary" size="sm" data-ui="hive.run.pause">Pause</Button>
        <Button type="button" size="sm" data-ui="hive.attention.inbox">Attention (3)</Button>
      </header>

      <div className="hive-run-attention" data-ui="hive.attention.banner">
        <span className="hive-run-attention__dot" aria-hidden />
        <span><strong>3 items</strong> need you — approvals, gates, or blocked steps.</span>
        <Button type="button" variant="outline" size="sm" className="ml-auto">Open inbox</Button>
      </div>

      <aside className="hive-workstation__sidebar" aria-label="Runs">
        <div className="hive-workstation__sidebar-label">Runs</div>
        {HIVE_RUNS.map((run) => (
          <button
            key={run.id}
            type="button"
            className="hive-workstation__run"
            data-active={run.id === activeRunId}
            onClick={() => setActiveRunId(run.id)}
          >
            <span className="hive-workstation__run-name">{run.name}</span>
            <span className="hive-workstation__run-meta">
              <RunStatusPill run={run} />
              <span>{run.unitCount} steps</span>
            </span>
          </button>
        ))}
      </aside>

      <div className="hive-workstation__kpis">
        {[
          { label: 'Workers live', value: '12', sub: 'auto-scaled across providers' },
          { label: 'Steps waiting', value: '88', sub: 'queue depth' },
          { label: 'Finished · failed', value: '47 · 2', sub: 'retries in flight: 2' },
          { label: 'Release gates', value: '3', sub: 'waiting on you' }
        ].map((kpi) => (
          <div key={kpi.label} className="hive-workstation__kpi">
            <div className="hive-workstation__kpi-label">{kpi.label}</div>
            <div className="hive-workstation__kpi-value">{kpi.value}</div>
            <div className="hive-workstation__kpi-sub">{kpi.sub}</div>
          </div>
        ))}
      </div>

      <main className="hive-workstation__main">
        <div className="hive-workstation__toolbar">
          <div className="hive-workstation__tabs" role="tablist">
            {([
              ['pulse', 'Pulse', 'hive.view.pulse'],
              ['workers', 'Workers', 'hive.view.workers'],
              ['signal', 'Signal', 'hive.view.signal'],
              ['gates', 'Gates', 'hive.view.gates']
            ] as const).map(([id, label, ui]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className="hive-workstation__tab"
                data-active={mainView === id}
                data-ui={ui}
                aria-selected={mainView === id}
                onClick={() => setMainView(id)}
              >
                {label}
                {id === 'workers' && <span className="hive-workstation__pill">12</span>}
              </button>
            ))}
          </div>
          <Input className="h-8 max-w-[200px]" placeholder="Filter steps…" aria-label="Filter steps" />
        </div>

        {mainView === 'pulse' && (
          <div className="hive-workstation__body">
            <section className="hive-workstation__board" aria-label="Run pulse">
              <div className="hive-workstation__kanban">
                {(Object.keys(STAGE_LABELS) as HiveUnit['column'][]).map((column) => (
                  <div key={column} className="hive-workstation__column">
                    <div className="hive-workstation__column-hd">
                      {STAGE_LABELS[column]}
                      <span className="hive-workstation__pill">{stepsByStage[column].length}</span>
                    </div>
                    <div className="hive-workstation__column-bd">
                      {stepsByStage[column].map((step) => (
                        <button
                          key={step.id}
                          type="button"
                          className="hive-workstation__unit"
                          data-selected={step.id === selectedStepId}
                          onClick={() => setSelectedStepId(step.id)}
                        >
                          <div className="hive-workstation__unit-title">{step.title}</div>
                          <div className="hive-workstation__unit-row">
                            {step.provider && <ProviderMark provider={step.provider} className="size-3" />}
                            <StepStatePill step={step} />
                            {step.worktree && <span className="font-mono text-[11px]">{step.worktree}</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <aside className="hive-workstation__graph" aria-label="Run topology">
              <FlowGraph />
              <p>Topology appears once the run is planning. Pinch to zoom in a later build.</p>
            </aside>
          </div>
        )}

        {mainView === 'workers' && (
          <div className="hive-workstation__workers">
            <Card className="hive-workstation__card-tight py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Worker</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Step</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Elapsed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {HIVE_WORKERS.map((row) => (
                    <TableRow key={row.id} data-state={row.selected ? 'selected' : undefined}>
                      <TableCell className="font-mono text-xs">{row.id}</TableCell>
                      <TableCell>
                        <span className="hive-workstation__pill inline-flex gap-1.5">
                          <ProviderMark provider={row.provider} className="size-3" />
                          {row.provider}
                        </span>
                      </TableCell>
                      <TableCell>{row.unitTitle}</TableCell>
                      <TableCell className="font-mono text-xs">{row.worktree}</TableCell>
                      <TableCell>
                        <span className={cn('hive-workstation__pill', row.state === 'running' && 'hive-workstation__pill--run',
                          row.state === 'review' && 'hive-workstation__pill--warn')}>{row.state}</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.runtime}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>
        )}

        {mainView === 'signal' && (
          <div className="hive-workstation__insp-body" style={{ flex: 1 }}>
            <Card className="hive-workstation__card-tight py-0">
              <CardHeader>
                <CardTitle className="text-sm">Signal</CardTitle>
                <CardDescription>Append-only run events — no chat transcript.</CardDescription>
              </CardHeader>
              <CardContent className="font-mono text-xs text-muted-foreground space-y-2">
                <p>14:02:08 · w-7f2a · artifact ready</p>
                <p>13:58:41 · scheduler · step re-queued (capacity)</p>
                <p>13:55:02 · verify · comparison started</p>
              </CardContent>
            </Card>
          </div>
        )}

        {mainView === 'gates' && (
          <div className="hive-workstation__insp-body" style={{ flex: 1 }}>
            <Card className="hive-workstation__card-tight py-0 mb-3">
              <CardHeader>
                <CardTitle className="text-sm">Gate · step 38</CardTitle>
                <CardDescription>Release candidate passed checks — approve to merge scope.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button type="button" size="sm" data-ui="hive.gate.approve">Approve</Button>
                <Button type="button" size="sm" variant="outline">Inspect artifacts</Button>
                <Button type="button" size="sm" variant="destructive">Reject</Button>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      <aside className="hive-workstation__inspector" data-ui="hive.inspector">
        <div className="hive-workstation__insp-hd">
          <span className="hive-workstation__insp-title">{selectedStep.title}</span>
        </div>
        <div className="hive-workstation__insp-tabs">
          {(['step', 'steer', 'artifacts'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className="hive-workstation__insp-tab"
              data-active={detailView === tab}
              onClick={() => setDetailView(tab)}
            >
              {tab === 'step' ? 'Step' : tab === 'steer' ? 'Steer' : 'Artifacts'}
            </button>
          ))}
        </div>
        <div className="hive-workstation__insp-body">
          {detailView === 'step' && (
            <Card className="hive-workstation__card-tight py-0">
              <CardHeader>
                <CardTitle className="text-sm">Worker assignment</CardTitle>
                <CardDescription>Chosen from live provider capacity — not configured upfront.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {selectedStep.provider && (
                  <span className="hive-workstation__pill inline-flex gap-1.5">
                    <ProviderMark provider={selectedStep.provider} className="size-3" />
                    {selectedStep.providerLabel ?? selectedStep.provider}
                  </span>
                )}
                <div className="hive-workstation__cap-bar"><span className="hive-workstation__cap-fill" style={{ width: '62%' }} /></div>
                <p className="text-xs text-muted-foreground">Budget 62%</p>
              </CardContent>
            </Card>
          )}
          {detailView === 'steer' && (
            <Card className="hive-workstation__card-tight py-0">
              <CardHeader>
                <CardTitle className="text-sm">Steer this run</CardTitle>
                <CardDescription>One line redirects the whole hive — not a chat pane.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">Shift priority: finish verify wave before new steps.</CardContent>
            </Card>
          )}
          {detailView === 'artifacts' && (
            <Card className="hive-workstation__card-tight py-0">
              <CardContent className="font-mono text-xs text-muted-foreground pt-4">artifact://run/step-41/output.patch</CardContent>
            </Card>
          )}
        </div>
        <div className="hive-workstation__composer">
          <p className="text-xs text-muted-foreground mb-1.5">Steer run</p>
          <div className="hive-workstation__composer-box">Pause new steps until gate 38 clears…</div>
          <div className="flex justify-end mt-2"><Button type="button" size="sm">Send</Button></div>
        </div>
      </aside>

      <footer className="hive-workstation__statusbar">
        <strong className="text-foreground">Provider load</strong>
        {PROVIDER_CAPACITY.map((cap) => (
          <div key={cap.provider} className="hive-workstation__cap">
            <ProviderMark provider={cap.provider} className="size-3" />
            {cap.label}
            <div className="hive-workstation__cap-bar">
              <span className="hive-workstation__cap-fill" style={{ width: `${(cap.active / cap.max) * 100}%` }} />
            </div>
            <span className="font-mono">{cap.active}/{cap.max}</span>
          </div>
        ))}
      </footer>
    </div>
  )
}
