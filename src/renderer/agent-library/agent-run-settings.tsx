import type { JSX } from 'react'
import { useId } from 'react'

import { Button } from '../../components/ui/button.js'
import { Input } from '../../components/ui/input.js'
import { Switch } from '../../components/ui/switch.js'
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group.js'
import { timeLimitError, withTimeLimit, type AgentDraft, type AgentTimeUnit } from './agent-draft.js'

// How long a run goes and how much it does on its own. Every control here is a setting the main
// process applies to the run itself (agent-run-service.ts): the cycle cap and the time limit
// pause it when a turn ends, and a supervised run waits for Resume after each cycle. None of them is advice to
// the model, and the helper text says what the app will do.

export type AgentRunSettingsProps = {
  draft: AgentDraft
  disabled: boolean
  /** The optimizer's limits when they differ from the fields, as a phrase; null hides the row. */
  suggestedLimits: string | null
  onChange: (draft: AgentDraft) => void
  onApplySuggested: () => void
}

export function AgentRunSettings({ draft, disabled, suggestedLimits, onChange, onApplySuggested }: AgentRunSettingsProps): JSX.Element {
  const timeId = useId()
  const autonomyId = useId()
  const timeError = timeLimitError(draft)
  return (
    <fieldset className="agent-settings" disabled={disabled}>
      <legend className="agent-builder-label">Run settings</legend>
      <div className="agent-setting">
        <label className="agent-setting-name" htmlFor={`${timeId}-cycles`}>Cycle limit</label>
        <Input id={`${timeId}-cycles`} className="agent-library-field agent-setting-number" data-ui="agents.max-cycles" type="number" min={1}
          inputMode="numeric" value={draft.maxCycles} placeholder="None" onChange={(event) => onChange({ ...draft, maxCycles: event.target.value })} />
        <span className="agent-setting-note">{draft.maxCycles.trim() ? 'Pauses when that cycle ends' : 'Runs until paused or finished'}</span>
      </div>
      <div className="agent-setting">
        <label className="agent-setting-name" htmlFor={timeId}>Time limit</label>
        <Switch id={timeId} data-ui="agents.time-limit" checked={draft.timeLimited} onCheckedChange={(on) => onChange(withTimeLimit(draft, on))} />
        {draft.timeLimited ? (
          <>
            <Input className="agent-library-field agent-setting-number" data-ui="agents.time-amount" type="number" min={1} inputMode="decimal"
              aria-label="Time limit amount" aria-invalid={timeError ? true : undefined} value={draft.timeAmount}
              onChange={(event) => onChange({ ...draft, timeAmount: event.target.value })} />
            <ToggleGroup type="single" variant="outline" size="sm" className="agent-setting-unit" aria-label="Time limit unit" value={draft.timeUnit}
              onValueChange={(unit) => { if (unit) onChange({ ...draft, timeUnit: unit as AgentTimeUnit }) }}>
              <ToggleGroupItem value="minutes" className="h-7 px-2" data-ui="agents.time-unit" data-ui-key="minutes">min</ToggleGroupItem>
              <ToggleGroupItem value="hours" className="h-7 px-2" data-ui="agents.time-unit" data-ui-key="hours">hours</ToggleGroupItem>
            </ToggleGroup>
          </>
        ) : null}
        <span className="agent-setting-note" role={timeError ? 'alert' : undefined} data-tone={timeError ? 'error' : undefined}>
          {timeError ?? (draft.timeLimited ? 'Of running time; the turn in flight finishes first' : 'No time limit')}
        </span>
      </div>
      {suggestedLimits && (
        <div className="agent-setting agent-setting-suggested">
          <span className="agent-setting-note">Suggested limits: {suggestedLimits}</span>
          <Button type="button" variant="ghost" size="xs" data-ui="agents.apply-suggested-limits" onClick={onApplySuggested}>Apply</Button>
        </div>
      )}
      <div className="agent-setting">
        <label className="agent-setting-name" htmlFor={autonomyId}>Autonomous</label>
        <Switch id={autonomyId} data-ui="agents.autonomy" checked={draft.autonomous} onCheckedChange={(on) => onChange({ ...draft, autonomous: on })} />
        <span className="agent-setting-note">
          {draft.autonomous ? 'The next cycle is sent as soon as a turn ends' : 'Supervised: pauses after every cycle until you resume it'}
        </span>
      </div>
    </fieldset>
  )
}
