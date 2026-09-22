import type { JSX } from 'react'
import type { HiveRunSummary, HiveUnit } from './hive-fixture.js'

export function RunStatusPill({ run }: { run: HiveRunSummary }): JSX.Element {
  if (run.status === 'running') {
    return <span className="hive-workstation__pill hive-workstation__pill--run">Running</span>
  }
  if (run.status === 'paused') {
    return <span className="hive-workstation__pill hive-workstation__pill--warn">Paused</span>
  }
  return <span className="hive-workstation__pill">Completed</span>
}

export function StepStatePill({ step }: { step: HiveUnit }): JSX.Element | null {
  if (step.badge === 'running') return <span className="hive-workstation__pill hive-workstation__pill--run">{step.providerLabel ?? 'Active'}</span>
  if (step.badge === 'judging') return <span className="hive-workstation__pill hive-workstation__pill--warn">Verify</span>
  if (step.badge === 'merged') return <span className="hive-workstation__pill hive-workstation__pill--ok">Done</span>
  if (step.role) return <span className="hive-workstation__pill">{step.role}</span>
  return null
}
