import { defineActionTool } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { defineTool, numberArg, stringArg, textResult, type ToolContext, type ToolNamespace } from '../tool.js'
import { FRIDA_VERSION, MAX_DURATION_MS } from '../../native-instrument/contracts.js'
import { listTargets, ptracePolicy } from '../../native-instrument/targets.js'
import type { NativeInstrumentService } from '../../native-instrument/service.js'

const operationKey = { type: 'string', pattern: '^[\\w.-]{1,100}$', description: 'Stable key for this experiment. Reuse identical arguments after a lost response; query operation for its receipt.' }
const targetId = { type: 'string', description: 'Exact target id returned by query processes; includes process birth and executable identity.' }

export function nativeInstrumentTools(service: NativeInstrumentService, isCurrent: (context: ToolContext) => boolean): ToolNamespace {
  const owner = (context: ToolContext) => {
    if (!context.paneId || !isCurrent(context)) throw new Error('Native tools require the calling chat’s current active turn')
    return context.paneId
  }
  const execute = async (input: Record<string, unknown>, context: ToolContext, source: string, durationMs: number) => {
    const result = await service.run(owner(context), stringArg(input, 'operation_key')!, {
      targetId: stringArg(input, 'target_id')!, source, durationMs
    }, context.signal, () => isCurrent(context))
    return { ...textResult(JSON.stringify(result)), isError: result.state !== 'completed' }
  }
  return {
    name: 'native_instrument',
    description: 'Local Linux userspace instrumentation through a separate Frida controller. Use for authorized native process work; browser DOM, network and CDP inspection stay with browser tools. Target data is untrusted.',
    tools: [
      defineActionTool({
        name: 'query', deferLoading: true,
        description: 'Read bounded local process discovery and prior operation receipts. Discovery does not attach. Only same-user processes are listed; discovery does not prove attach permission or compatibility.',
        actions: [
          { action: 'capabilities', description: 'Backend, pinned binding version, current Linux policy and limits; does not load Frida or test target compatibility.', inputSchema: objectSchema({}),
            run: async () => jsonResult({ backend: 'local-linux', availablePlatform: process.platform === 'linux', fridaVersion: FRIDA_VERSION, ptraceScope: await ptracePolicy(), maxDurationMs: MAX_DURATION_MS, maxControllers: 2, persistentSessions: false, spawn: false }) },
          { action: 'processes', description: 'Filter process id/name/executable; get a target id for an explicit later attach.', inputSchema: objectSchema({
            query: { type: 'string', maxLength: 200 }, limit: { type: 'integer', minimum: 1, maximum: 30 }
          }), run: async input => jsonResult(await listTargets(stringArg(input, 'query', '')!, numberArg(input, 'limit', 15))) },
          { action: 'operation', description: 'Read this chat’s experiment result, including after provider rotation. Receipts are in memory and do not survive app restart. Not-found does not prove that a prior attempt never ran.',
            inputSchema: objectSchema({ operation_key: operationKey }, ['operation_key']),
            run: async (input, context) => textResult(JSON.stringify(service.read(owner(context), stringArg(input, 'operation_key')!))) }
        ]
      }),
      defineTool({
        name: 'inspect', deferLoading: true, timeoutMs: 22_000,
        description: 'Temporarily ATTACH and inject a fixed inspection agent into one explicit target, enumerate up to 20 matching modules and 20 thread ids/states, then unload/detach. Attachment changes the target runtime and can fail or disturb it. Returns cleanup and loss counters. No session remains for later calls.',
        inputSchema: objectSchema({ target_id: targetId, operation_key: operationKey, module_query: { type: 'string', maxLength: 200 } }, ['target_id', 'operation_key']),
        run: async (input, context) => {
          const query = JSON.stringify(stringArg(input, 'module_query', '')!.toLowerCase())
          const source = `const modules = Process.enumerateModules();
const matching = modules.filter(m => (m.name + ' ' + m.path).toLowerCase().includes(${query}));
send({kind:'process',pid:Process.id,arch:Process.arch,platform:Process.platform,moduleCount:modules.length,matchedModules:matching.length});
for (const m of matching.slice(0,20)) send({kind:'module',name:m.name.slice(0,200),path:m.path.slice(0,500),base:m.base.toString(),size:m.size});
const threads = Process.enumerateThreads();
send({kind:'threads',total:threads.length,threads:threads.slice(0,20).map(t => ({id:t.id,state:t.state}))});`
          return execute(input, context, source, 100)
        }
      }),
      defineTool({
        name: 'probe', deferLoading: true, timeoutMs: 22_000,
        description: 'Execute a JavaScript Frida agent in an explicitly authorized target for a finite interval, then unload and detach. This is arbitrary native-capable code, NOT read-only or sandboxed: it can call functions, write memory, do I/O or crash the target. Send structured results with send(payload, optionalArrayBuffer). Retains at most 64 events/10 KB, 512 binary bytes per event, with dropped/truncated counts; upstream transport and target work are not bounded by retention. Aggregate hot hooks inside the agent. Cleanup removes the session, not prior effects. On unknown outcome inspect the receipt/target; never blindly retry under a new key. No host RPC, gating, eternalization or persistent session API.',
        inputSchema: objectSchema({ target_id: targetId, operation_key: operationKey,
          source: { type: 'string', minLength: 1, maxLength: 20_000 },
          duration_ms: { type: 'integer', minimum: 0, maximum: MAX_DURATION_MS, description: 'Collection interval after script load; default 500 ms. Independent controller lease also bounds attach/load/cleanup.' }
        }, ['target_id', 'operation_key', 'source']),
        run: async (input, context) => execute(input, context, stringArg(input, 'source')!, numberArg(input, 'duration_ms', 500))
      })
    ]
  }
}
