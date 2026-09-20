import type { JsonObject } from '../tool.js'

// A sequential batch is one plan. When a step fails, the steps that already ran are not
// automatically harmless: some of them arm state inside a browser tab that nothing on screen
// reveals — profiling recorders, a pre-document hook, a device override. Left behind, that state
// outlives the plan it belonged to and perturbs whatever the tab does next. Measured here: a
// batch that armed profiling recorders and then lost its navigation left them running on a live
// tab, and the following load failed.
//
// Compensation covers exactly that class: invisible state with a defined inverse. Visible or
// consequential mutations — a tab that was opened, a cookie that was written, a network rule the
// caller can list — are deliberately not undone, because unwinding those is a decision, not
// bookkeeping.

export type CompensableCall = {
  namespace: string | null
  tool: string
  arguments: JsonObject
}

export type Compensation = {
  /** Human-readable for the batch report: what is being put back. */
  label: string
  call: { namespace: string; tool: string; arguments: JsonObject }
}

type Rule = {
  namespace: string
  tool: string
  /** The verb that arms state. */
  arms: string
  /** The verb that releases it. */
  releases: string
  describe: (target: string) => string
}

const RULES: Rule[] = [
  {
    namespace: 'browser_cdp',
    tool: 'profile',
    arms: 'start',
    releases: 'stop',
    describe: (target) => `profiling recorders on ${target}`
  },
  {
    namespace: 'browser_cdp',
    tool: 'instrument',
    arms: 'hook',
    releases: 'unhook',
    describe: (target) => `the pre-document recorder on ${target}`
  },
  {
    namespace: 'browser_cdp',
    tool: 'emulate',
    arms: 'apply',
    releases: 'reset',
    describe: (target) => `device emulation on ${target}`
  }
]

function actionOf(call: CompensableCall): string {
  return typeof call.arguments.action === 'string' ? call.arguments.action : ''
}

function tabOf(call: CompensableCall): string | null {
  const tab = call.arguments.tab_id
  return typeof tab === 'string' && tab.length > 0 ? tab : null
}

function ruleFor(call: CompensableCall, verb: (rule: Rule) => string): Rule | null {
  const action = actionOf(call)
  return RULES.find((rule) =>
    rule.namespace === call.namespace && rule.tool === call.tool && verb(rule) === action) ?? null
}

/** What would put the tab back, if this call armed something. Null for everything else. */
export function compensationFor(call: CompensableCall): Compensation | null {
  if (call.namespace === 'closedai_app' && call.tool === 'command' &&
    actionOf(call) === 'project_switch' && call.arguments.op === 'request') {
    return { label: 'the queued project switch', call: {
      namespace: 'closedai_app', tool: 'command', arguments: { action: 'project_switch', op: 'cancel' }
    } }
  }
  const rule = ruleFor(call, (candidate) => candidate.arms)
  if (!rule) return null
  const tab = tabOf(call)
  return {
    label: rule.describe(tab ?? 'the active tab'),
    call: {
      namespace: rule.namespace,
      tool: rule.tool,
      arguments: { action: rule.releases, ...(tab ? { tab_id: tab } : {}) }
    }
  }
}

/**
 * True when this call is itself the release the plan already intended — a batch that arms, uses,
 * and stops needs no unwinding of the part it completed on purpose.
 */
export function releases(call: CompensableCall, pending: Compensation): boolean {
  if (call.namespace === 'closedai_app' && call.tool === 'command' &&
    actionOf(call) === 'project_switch' && call.arguments.op === 'cancel') {
    return pending.call.namespace === 'closedai_app' && pending.call.arguments.action === 'project_switch'
  }
  const rule = ruleFor(call, (candidate) => candidate.releases)
  if (!rule || rule.namespace !== pending.call.namespace || rule.tool !== pending.call.tool) return false
  return (tabOf(call) ?? null) === (typeof pending.call.arguments.tab_id === 'string'
    ? pending.call.arguments.tab_id
    : null)
}
