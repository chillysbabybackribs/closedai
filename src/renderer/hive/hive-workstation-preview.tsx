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
import '../styles/hive/workstation.css'

type MainView = 'board' | 'workers' | 'events' | 'integrator'
type InspView = 'unit' | 'conductor' | 'diff'

const COLUMN_LABELS = {
  queued: 'Queued',
  running: 'Running',
  review: 'Review',
  done: 'Done'
} as const

function StatusPill({ run }: { run: (typeof HIVE_RUNS)[number] }): JSX.Element {
  if (run.status === 'running') {
    return <span className="hive-workstation__pill hive-workstation__pill--run">Running</span>
  }
  if (run.status === 'paused') {
    return <span className="hive-workstation__pill hive-workstation__pill--warn">Paused</span>
  }
  return <span className="hive-workstation__pill">Completed</span>
}

function UnitBadge({ unit }: { unit: HiveUnit }): JSX.Element | null {
  if (unit.badge === 'running') return <span className="hive-workstation__pill hive-workstation__pill--run">{unit.providerLabel ?? 'Running'}</span>
  if (unit.badge === 'judging') return <span className="hive-workstation__pill hive-workstation__pill--warn">judging</span>
  if (unit.badge === 'merged') return <span className="hive-workstation__pill hive-workstation__pill--ok">merged</span>
  if (unit.role) return <span className="hive-workstation__pill">{unit.role}</span>
  return null
}

function TaskGraph(): JSX.Element {
  return (
    <svg viewBox="0 0 260 300" className="w-full max-h-[280px]" aria-hidden>
      <defs>
        <marker id="hive-arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" opacity="0.45" />
        </marker>
      </defs>
      <rect x="95" y="8" width="70" height="28" rx="6" fill="var(--secondary)" stroke="var(--antigravity-blue, #8ab4f8)" />
      <text x="130" y="26" textAnchor="middle" fill="var(--foreground)" fontSize="10">Conductor</text>
      <line x1="130" y1="36" x2="130" y2="58" stroke="currentColor" opacity="0.35" markerEnd="url(#hive-arr)" />
      <rect x="20" y="60" width="56" height="24" rx="5" fill="var(--card)" stroke="var(--border)" />
      <text x="48" y="76" textAnchor="middle" fill="var(--muted-foreground)" fontSize="9">Wave 1</text>
      <rect x="102" y="60" width="56" height="24" rx="5" fill="var(--card)" stroke="var(--border)" />
      <text x="130" y="76" textAnchor="middle" fill="var(--muted-foreground)" fontSize="9">Wave 2</text>
      <rect x="184" y="60" width="56" height="24" rx="5" fill="var(--card)" stroke="var(--border)" />
      <text x="212" y="76" textAnchor="middle" fill="var(--muted-foreground)" fontSize="9">Wave 3</text>
      <rect x="88" y="232" width="84" height="28" rx="6" fill="var(--secondary)" stroke="#65b98a" />
      <text x="130" y="250" textAnchor="middle" fill="var(--foreground)" fontSize="10">Integrator + CI</text>
    </svg>
  )
}

export function HiveWorkstationPreview(): JSX.Element {
  const [activeRunId, setActiveRunId] = useState(HIVE_RUNS[0]!.id)
  const [mainView, setMainView] = useState<MainView>('board')
  const [inspView, setInspView] = useState<InspView>('unit')
  const [selectedUnitId, setSelectedUnitId] = useState('u-41')
  const selectedUnit = useMemo(() => HIVE_UNITS.find((u) => u.id === selectedUnitId) ?? HIVE_UNITS[2]!, [selectedUnitId])

  const unitsByColumn = useMemo(() => {
    const map: Record<HiveUnit['column'], HiveUnit[]> = { queued: [], running: [], review: [], done: [] }
    for (const unit of HIVE_UNITS) map[unit.column].push(unit)
    return map
  }, [])

  return (
    <div className="hive-workstation" data-ui="hive.workstation">
      <header className="hive-workstation__bar">
        <span className="hive-workstation__bar-brand">ClosedAI</span>
        <span>Hive</span>
        <span className="hive-workstation__bar-crumb">refactor auth middleware</span>
        <span className="hive-workstation__pill hive-workstation__pill--run">Running</span>
        <span className="hive-workstation__bar-spacer" />
        <Button type="button" variant="outline" size="sm">Open browser</Button>
        <Button type="button" variant="secondary" size="sm" data-ui="hive.run.pause">Pause hive</Button>
        <Button type="button" size="sm" data-ui="hive.integrator.merge">Review merge queue (3)</Button>
      </header>

      <aside className="hive-workstation__sidebar" aria-label="Hive runs">
        <div className="hive-workstation__sidebar-label">Hive runs</div>
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
              <StatusPill run={run} />
              <span>{run.unitCount} units</span>
            </span>
          </button>
        ))}
        <div className="hive-workstation__sidebar-foot">
          <Button type="button" variant="outline" className="w-full" data-ui="hive.run.new">New hive run…</Button>
        </div>
      </aside>

      <div className="hive-workstation__kpis">
        {[
          { label: 'Active workers', value: '12', sub: 'cap 32 across providers' },
          { label: 'Queued units', value: '88', sub: 'ETA ~4h at current mix' },
          { label: 'Succeeded / failed', value: '47 · 2', sub: '2 auto-retry, 0 blocked' },
          { label: 'Integrator', value: '3 pending', sub: 'human gate before merge' }
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
              ['board', 'Board', 'hive.view.board'],
              ['workers', 'Workers', 'hive.view.workers'],
              ['events', 'Event log', 'hive.view.events'],
              ['integrator', 'Integrator', 'hive.view.integrator']
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
          <Input className="h-8 max-w-[200px]" placeholder="Filter units…" aria-label="Filter units" />
          <span className="hive-workstation__toolbar-spacer" />
          <Button type="button" variant="ghost" size="sm">Export run report</Button>
        </div>

        {mainView === 'board' && (
          <div className="hive-workstation__body">
            <section className="hive-workstation__board" aria-label="Kanban board">
              <div className="hive-workstation__kanban">
                {(Object.keys(COLUMN_LABELS) as HiveUnit['column'][]).map((column) => (
                  <div key={column} className="hive-workstation__column">
                    <div className="hive-workstation__column-hd">
                      {COLUMN_LABELS[column]}
                      <span className="hive-workstation__pill">{unitsByColumn[column].length}</span>
                    </div>
                    <div className="hive-workstation__column-bd">
                      {unitsByColumn[column].map((unit) => (
                        <button
                          key={unit.id}
                          type="button"
                          className="hive-workstation__unit"
                          data-selected={unit.id === selectedUnitId}
                          onClick={() => setSelectedUnitId(unit.id)}
                        >
                          <div className="hive-workstation__unit-title">{unit.title}</div>
                          <div className="hive-workstation__unit-row">
                            {unit.provider && <ProviderMark provider={unit.provider} className="size-3" />}
                            <UnitBadge unit={unit} />
                            {unit.worktree && <span className="font-mono text-[11px]">{unit.worktree}</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <aside className="hive-workstation__graph" aria-label="Task graph preview">
              <TaskGraph />
              <p>Full Graph tab would add pan/zoom. Node click selects a unit in the board and inspector.</p>
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
                    <TableHead>Unit</TableHead>
                    <TableHead>Worktree</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Runtime</TableHead>
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
                  <TableRow>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell><span className="hive-workstation__pill">idle slot</span></TableCell>
                    <TableCell colSpan={4} className="text-muted-foreground text-xs">
                      Cursor at capacity — next unit waits or fails over to Codex
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Card>
          </div>
        )}

        {mainView === 'events' && (
          <div className="hive-workstation__insp-body" style={{ flex: 1 }}>
            <Card className="hive-workstation__card-tight py-0">
              <CardHeader>
                <CardTitle className="text-sm">Event log</CardTitle>
                <CardDescription>Append-only hive events (fixture).</CardDescription>
              </CardHeader>
              <CardContent className="font-mono text-xs text-muted-foreground space-y-2">
                <p>14:02:08 · w-7f2a · patch ready · 842 lines</p>
                <p>13:58:41 · scheduler · Unit 53 re-queued → Codex (Claude at cap)</p>
                <p>13:55:02 · u-38 · best-of-3 · tests started</p>
              </CardContent>
            </Card>
          </div>
        )}

        {mainView === 'integrator' && (
          <div className="hive-workstation__insp-body" style={{ flex: 1 }}>
            <Card className="hive-workstation__card-tight py-0 mb-3">
              <CardHeader>
                <CardTitle className="text-sm">Pending merge · Unit 38</CardTitle>
                <CardDescription>Winner: Codex attempt B · 3 files · CI green on worktree</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button type="button" size="sm">Apply to main</Button>
                <Button type="button" size="sm" variant="outline">Open diff</Button>
                <Button type="button" size="sm" variant="destructive">Reject</Button>
              </CardContent>
            </Card>
            <Card className="hive-workstation__card-tight py-0">
              <CardHeader>
                <CardTitle className="text-sm">Integrator worker</CardTitle>
                <CardDescription>Single lane — often a different model tier than implementers.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 items-center">
                <span className="hive-workstation__pill inline-flex gap-1.5">
                  <ProviderMark provider="codex" className="size-3" /> Codex
                </span>
                <span className="hive-workstation__pill">Idle — waiting for approval</span>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      <aside className="hive-workstation__inspector" data-ui="hive.inspector.conductor">
        <div className="hive-workstation__insp-hd">
          <span className="hive-workstation__insp-title">{selectedUnit.title}</span>
        </div>
        <div className="hive-workstation__insp-tabs">
          {(['unit', 'conductor', 'diff'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className="hive-workstation__insp-tab"
              data-active={inspView === tab}
              onClick={() => setInspView(tab)}
            >
              {tab === 'unit' ? 'Unit' : tab === 'conductor' ? 'Conductor' : 'Diff'}
            </button>
          ))}
        </div>
        <div className="hive-workstation__insp-body">
          {inspView === 'unit' && (
            <>
              <Card className="hive-workstation__card-tight py-0">
                <CardHeader>
                  <CardTitle className="text-sm">Assignment</CardTitle>
                  <CardDescription>Scheduler picked provider from capacity + role template.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {selectedUnit.provider && (
                      <span className="hive-workstation__pill inline-flex gap-1.5">
                        <ProviderMark provider={selectedUnit.provider} className="size-3" />
                        {selectedUnit.providerLabel ?? selectedUnit.provider}
                      </span>
                    )}
                    <span className="hive-workstation__pill hive-workstation__pill--run">Running · 14m</span>
                    {selectedUnit.worktree && <span className="hive-workstation__pill font-mono">{selectedUnit.worktree}</span>}
                  </div>
                  <div className="hive-workstation__cap-bar" aria-hidden>
                    <span className="hive-workstation__cap-fill" style={{ width: '62%' }} />
                  </div>
                  <p className="text-xs text-muted-foreground">Budget 62% · tests not started</p>
                </CardContent>
              </Card>
              <Card className="hive-workstation__card-tight py-0">
                <CardHeader>
                  <CardTitle className="text-sm">Acceptance</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground font-mono leading-relaxed">
                  npm run typecheck · node --test src/auth/session.test.ts · scope src/auth/*
                </CardContent>
              </Card>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm">Open worker log</Button>
                <Button type="button" variant="outline" size="sm" data-ui="hive.unit.retry">Re-queue on Codex</Button>
                <Button type="button" variant="destructive" size="sm">Cancel unit</Button>
              </div>
            </>
          )}
          {inspView === 'conductor' && (
            <Card className="hive-workstation__card-tight py-0">
              <CardHeader>
                <CardTitle className="text-sm">Conductor thread</CardTitle>
                <CardDescription>Messages apply to the whole hive run.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed space-y-3">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">You</p>
                <p>Refactor auth middleware for JWT + refresh; keep public API stable.</p>
                <p className="text-muted-foreground text-xs uppercase tracking-wide">Conductor</p>
                <p>Split into 100 units; wave 2 starts after session store lands.</p>
              </CardContent>
            </Card>
          )}
          {inspView === 'diff' && (
            <Card className="hive-workstation__card-tight py-0">
              <CardContent className="font-mono text-xs text-muted-foreground pt-4">
                --- a/src/auth/session.ts{'\n'}+++ b/src/auth/session.ts{'\n'}@@ -1,4 +1,6 @@{'\n'}+// hive unit 41
              </CardContent>
            </Card>
          )}
        </div>
        <div className="hive-workstation__composer">
          <p className="text-xs text-muted-foreground mb-1.5">Message conductor</p>
          <div className="hive-workstation__composer-box">Shift scope: skip rate-limit units until JWT lands…</div>
          <div className="flex justify-end mt-2">
            <Button type="button" size="sm">Send</Button>
          </div>
        </div>
      </aside>

      <footer className="hive-workstation__statusbar">
        <strong className="text-foreground">Provider capacity</strong>
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
        <span className="hive-workstation__bar-spacer" />
        <span className="font-mono">~/projects/my-app · main + 12 worktrees</span>
      </footer>
    </div>
  )
}
