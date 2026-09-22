import type { JSX } from 'react'
import { useState } from 'react'
import { HivePulseView } from './hive-pulse-view.js'
import { HiveRunView } from './hive-run-view.js'
import { HiveSetupView } from './hive-setup-view.js'
import '../styles/hive/workstation.css'

export function HiveWorkstationPreview(): JSX.Element {
  const [phase, setPhase] = useState<'setup' | 'pulse' | 'run'>('setup')
  const [runTitle, setRunTitle] = useState('refactor auth middleware')

  if (phase === 'setup') {
    return (
      <HiveSetupView
        onStart={(goal) => {
          setRunTitle(goal.length > 48 ? `${goal.slice(0, 48)}…` : goal)
          setPhase('pulse')
        }}
        onOpenRun={(id) => {
          const run = id === 'run-1' ? 'refactor auth middleware' : id === 'run-2' ? 'migrate tests to vitest' : 'docs sweep'
          setRunTitle(run)
          setPhase('run')
        }}
      />
    )
  }

  if (phase === 'pulse') {
    return (
      <HivePulseView
        runTitle={runTitle}
        onCancel={() => setPhase('setup')}
        onReady={() => setPhase('run')}
      />
    )
  }

  return (
    <HiveRunView
      runTitle={runTitle}
      onNewRun={() => setPhase('setup')}
    />
  )
}
