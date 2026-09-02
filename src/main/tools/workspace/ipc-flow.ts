import type { ToolAction } from '../action-tool.js'
import { stringArg, textResult } from '../tool.js'
import { inputSchema, ipcFlows } from './query.js'

export const ipcFlowAction: ToolAction = {
  action: 'ipc_flow',
  description:
    'Show generated preload IPC namespace-to-main owner mappings. Omit namespace to list every mapping.',
  inputSchema: inputSchema({
    namespace: { type: 'string', minLength: 1, description: 'IPC namespace, such as chat or browserDownloads.' }
  }),
  async run(input) {
    const requested = stringArg(input, 'namespace')?.replace(/:\*$/, '')
    const rows = Object.entries(ipcFlows)
      .filter(([namespace]) => !requested || namespace === requested)
      .map(([namespace, owners]) => `${namespace}:* -> ${owners.join(', ')}`)
    if (rows.length === 0) throw new Error(`no indexed IPC namespace matches ${JSON.stringify(requested)}`)
    return textResult(`Preload IPC ownership\n\n${rows.join('\n')}`)
  }
}
