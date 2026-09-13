import { defineActionTool, type ToolAction } from '../action-tool.js'
import { booleanArg, REAL_INPUT_FALLBACK_FIELD, requireRealInputFallback, stringArg, type ToolNamespace } from '../tool.js'
import type { ArtifactService } from '../../investigations/artifact-service.js'
import {
  eventCursorFrom,
  eventLimitFrom,
  paramsFrom,
  sessionIdField,
  sessionIdFrom,
  tabIdField,
  tabIdFrom
} from './fields.js'
import { requireCdp, type CdpHostProvider } from './host.js'
import { bodyAction, requestsAction } from './network.js'
import { cdpEmulateTool } from './emulate.js'
import { cdpInstrumentTool } from './instrument.js'
import { cdpPageTool } from './page.js'
import { cdpProfileTool } from './profile.js'
import { jsonResult, objectSchema } from '../json-result.js'

export function cdpTools(cdp: CdpHostProvider, artifacts?: ArtifactService): ToolNamespace {
  return {
    name: 'browser_cdp',
    description: 'Low-level Chrome DevTools Protocol access to tabs owned by the embedded browser.',
    tools: [
      defineActionTool({
        name: 'protocol',
        deferLoading: true,
        description:
          'Advanced CDP access when embedded_browser page, network, or session tools lack a needed capability. ' +
          'Use capabilities for supported domains, targets for child sessions, command for Domain.method, ' +
          'and events after enabling a domain. IDs may expire after navigation; pass child sessionId as session_id. ' +
          'Raw Input.* requires fallback_reason and batched inspection/verification. Use closedai_ui.capture for images. ' +
          'Returns JSON text; JSON.parse in exec. command retain=true archives the full JSON response before output truncation ' +
          'and returns a durable receipt for investigation.read/manage; requires explicit tab_id, operation_key and label. ' +
          'Without retention oversized results carry _closedai_truncated.',
        actions: actions(cdp, artifacts)
      }),
      cdpPageTool(cdp),
      cdpProfileTool(cdp),
      cdpInstrumentTool(cdp),
      cdpEmulateTool(cdp)
    ]
  }
}

function actions(cdp: CdpHostProvider, artifacts?: ArtifactService): ToolAction[] {
  return [
    {
      action: 'capabilities',
      description: 'Return Browser.getVersion and the domains supported by the selected tab target.',
      inputSchema: objectSchema({ tab_id: tabIdField }),
      run: async (input) => jsonResult(await requireCdp(cdp).capabilities(tabIdFrom(input)))
    },
    {
      action: 'targets',
      description: 'Return the selected tab target, Chromium’s discovered targets, and a live inventory with child session ids.',
      inputSchema: objectSchema({ tab_id: tabIdField }),
      run: async (input) => jsonResult(await requireCdp(cdp).targets(tabIdFrom(input)))
    },
    {
      action: 'command',
      description:
        'Send an arbitrary CDP Domain.method with a JSON params object. Optional session_id routes it to a flat child-target session. ' +
        'Input.* methods require fallback_reason and must be batched with inspection and verification. ' +
        'retain=true explicitly stores the full result (including any private content) in this chat/project. ' +
        'Reuse operation_key and identical arguments after uncertainty: committed retries return the original receipt ' +
        'without executing CDP; interrupted reservations refuse reexecution. Retention does not make a mutating command read-only.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        method: { type: 'string', minLength: 3, description: 'CDP method, for example DOM.getDocument or Network.enable.' },
        params: { type: 'object', description: 'The command parameters; defaults to an empty object.' },
        session_id: sessionIdField,
        retain: { type: 'boolean', description: 'Retain full raw host response JSON instead of returning it inline; default false.' },
        operation_key: { type: 'string', minLength: 1, maxLength: 256, description: 'Required with retain. A stable key for this acquisition; reuse on retry.' },
        label: { type: 'string', minLength: 1, maxLength: 200, description: 'Required with retain. A short artifact label.' },
        fallback_reason: REAL_INPUT_FALLBACK_FIELD
      }, ['method']),
      run: async (input, context) => {
        const method = stringArg(input, 'method')!
        if (!/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/.test(method)) {
          throw new Error('`method` must use CDP Domain.method syntax')
        }
        if (method.startsWith('Input.')) requireRealInputFallback(input, context)
        const collect = () => requireCdp(cdp).command(tabIdFrom(input), method, paramsFrom(input), sessionIdFrom(input))
        if (booleanArg(input, 'retain', false)) {
          if (!artifacts) throw new Error('Durable artifact storage is unavailable')
          const tabId = tabIdFrom(input)
          const key = stringArg(input, 'operation_key')
          const label = stringArg(input, 'label')
          if (!tabId || !key || !label) throw new Error('retain requires explicit tab_id, operation_key and label')
          return jsonResult(await artifacts.retainProtocol(context, { key, label, tabId, method, params: paramsFrom(input), sessionId: sessionIdFrom(input) }, collect))
        }
        if (input.operation_key !== undefined || input.label !== undefined) throw new Error('operation_key and label require retain=true')
        return jsonResult(await collect())
      }
    },
    {
      action: 'target',
      description:
        'Perform a standard target lifecycle operation, then return the refreshed target inventory. ' +
        'Detach requires session_id; use command for non-standard Target domain parameters.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        operation: {
          type: 'string',
          enum: ['attach', 'detach', 'create', 'activate', 'close'],
          description: 'Target lifecycle operation.'
        },
        target_id: { type: 'string', minLength: 1, description: 'Required for attach, activate, and close.' },
        session_id: sessionIdField,
        url: { type: 'string', minLength: 1, description: 'Required for create.' }
      }, ['operation']),
      run: async (input) => {
        const operation = stringArg(input, 'operation')!
        const targetId = stringArg(input, 'target_id')
        const sessionId = stringArg(input, 'session_id')
        const url = stringArg(input, 'url')
        const lifecycle = targetLifecycleCommand(operation, targetId, sessionId, url)
        const host = requireCdp(cdp)
        const tabId = tabIdFrom(input)
        const result = await host.command(tabId, lifecycle.method, lifecycle.params)
        return jsonResult({ operation, result, inventory: await host.targets(tabId) })
      }
    },
    {
      action: 'events',
      description:
        'Read buffered CDP events after a cursor. Enable a domain first (for example Network.enable); use nextCursor on the following read.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        after_cursor: { type: 'integer', minimum: 0, description: 'Return events after this cursor; defaults to 0.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum events to return; defaults to 100.' },
        method_prefix: { type: 'string', minLength: 1, description: 'Optional prefix filter, for example Network. or Runtime.console.' }
      }),
      run: async (input) => jsonResult(requireCdp(cdp).events(
        tabIdFrom(input),
        eventCursorFrom(input),
        eventLimitFrom(input),
        stringArg(input, 'method_prefix')
      ))
    },
    requestsAction(cdp),
    bodyAction(cdp)
  ]
}

function targetLifecycleCommand(
  operation: string,
  targetId: string | undefined,
  sessionId: string | undefined,
  url: string | undefined
): { method: string; params: Record<string, unknown> } {
  switch (operation) {
    case 'attach':
      return { method: 'Target.attachToTarget', params: { targetId: requiredTargetArgument('target_id', targetId), flatten: true } }
    case 'detach':
      return { method: 'Target.detachFromTarget', params: { sessionId: requiredTargetArgument('session_id', sessionId) } }
    case 'create':
      return { method: 'Target.createTarget', params: { url: requiredTargetArgument('url', url) } }
    case 'activate':
      return { method: 'Target.activateTarget', params: { targetId: requiredTargetArgument('target_id', targetId) } }
    case 'close':
      return { method: 'Target.closeTarget', params: { targetId: requiredTargetArgument('target_id', targetId) } }
    default:
      throw new Error('`operation` must be attach, detach, create, activate, or close')
  }
}

function requiredTargetArgument(name: string, value: string | undefined): string {
  if (value) return value
  throw new Error('`' + name + '` is required for this target operation')
}

export type { CdpHostProvider, CdpToolHost } from './host.js'
