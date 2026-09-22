import type { JSX } from 'react'
import { useState } from 'react'
import { Button } from '../../components/ui/button.js'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js'
import { Collapsible, CollapsibleContent } from '../../components/ui/collapsible.js'
import { Input } from '../../components/ui/input.js'
import { HIVE_RUNS } from './hive-fixture.js'
import { RunStatusPill } from './hive-pills.js'

type HiveSetupViewProps = {
  onStart: (goal: string) => void
  onOpenRun: (runId: string) => void
}

export function HiveSetupView({ onStart, onOpenRun }: HiveSetupViewProps): JSX.Element {
  const [goal, setGoal] = useState('Refactor auth middleware for JWT + refresh; keep the public API stable.')
  const [advancedOpen, setAdvancedOpen] = useState(false)

  return (
    <div className="hive-setup" data-ui="hive.setup">
      <header className="hive-setup__bar">
        <span className="hive-setup__brand">ClosedAI</span>
        <span className="text-muted-foreground">Hive</span>
      </header>
      <div className="hive-setup__layout">
        <main className="hive-setup__main">
          <Card className="hive-setup__card shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-semibold tracking-tight">Start a run</CardTitle>
              <CardDescription>
                Describe the outcome. ClosedAI picks providers, splits work, and opens controls only after the run begins.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium">What should this run accomplish?</span>
                <textarea
                  className="hive-setup__goal"
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  rows={4}
                  data-ui="hive.setup.goal"
                />
              </label>
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <button
                  type="button"
                  className="hive-setup__advanced-toggle"
                  data-ui="hive.setup.advanced"
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  {advancedOpen ? 'Hide' : 'Fine-tune'} workspace &amp; limits
                </button>
                <CollapsibleContent>
                  <div className="hive-setup__advanced mt-3 space-y-3">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Workspace</span>
                      <Input defaultValue="/home/user/projects/my-app" className="h-9 font-mono text-xs" />
                    </label>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Providers: use every account you are signed into. Parallel cap adjusts automatically from live capacity.
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
              <Button
                type="button"
                size="lg"
                className="w-full sm:w-auto"
                data-ui="hive.setup.start"
                onClick={() => onStart(goal.trim() || 'Untitled run')}
              >
                Start run
              </Button>
            </CardContent>
          </Card>
          <p className="hive-setup__hint text-xs text-muted-foreground max-w-lg">
            No kanban, chat, or provider knobs until the run is live. Vertical work stays in panes; Hive only orchestrates.
          </p>
        </main>
        <aside className="hive-setup__aside" aria-label="Recent runs">
          <h2 className="hive-setup__aside-title">Recent runs</h2>
          <ul className="hive-setup__runs">
            {HIVE_RUNS.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  className="hive-setup__run-row"
                  onClick={() => onOpenRun(run.id)}
                >
                  <span className="hive-setup__run-name">{run.name}</span>
                  <span className="hive-setup__run-meta">
                    <RunStatusPill run={run} />
                    <span className="text-muted-foreground">{run.unitCount} steps</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}
