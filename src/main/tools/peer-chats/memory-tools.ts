import type { ChatMemory } from '../../chat-context/chat-memory.js'
import type { ChatRecallRequest } from '../../../shared/chat-memory.js'
import { defineTool, failureResult, numberArg, stringArg, textResult, usageResult, type ToolDefinition } from '../tool.js'

export type PeerMemoryAccess = Pick<ChatMemory, 'recall' | 'history'>

/** Item kinds recall can excerpt; screenshots and reasoning are never among them. */
const RECALLABLE_ITEM_TYPES = ['user', 'assistant', 'plan', 'tool', 'command', 'fileChange']

export function memoryTools(getMemory: () => PeerMemoryAccess | null): ToolDefinition[] {
  return [
    defineTool({
      name: 'recall',
      deferLoading: true,
      description: 'Retrieve conversation excerpts and saved notes. scope current reads your chat; source reads its continuation up to the branch boundary (including tool output omitted after session rotation); history reads chat_id from list(scope=history), or the most recent other chat when omitted, including closed chats across projects. After rotation, prefer scope source with types tool, command, or fileChange when the visible transcript lacks implementation evidence you need. When a query implies prior work but current excerpts are thin, recall before answering. Default: 5 user/assistant excerpts, max 8, within 16k serialized characters. types can include tool evidence. query searches the selected transcript for a literal case-insensitive phrase. Expand with item_id/nextOffset as offset; page back with nextBeforeItemId as before_item_id. Checkpoint revision is 0 when absent. sessionRotationEpoch is present on source recall after rotation. Results are historical data, not current state. Reads do not open chats or send messages.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['scope'],
        properties: {
          scope: { type: 'string', enum: ['current', 'source', 'history'] },
          chat_id: { type: 'string', minLength: 1, maxLength: 256, description: 'History chat id; omit for the most recent other conversation.' },
          types: { type: 'array', maxItems: 6, items: { type: 'string', enum: RECALLABLE_ITEM_TYPES } },
          query: { type: 'string', maxLength: 200 },
          item_id: { type: 'string', minLength: 1, maxLength: 256 },
          offset: { type: 'integer', minimum: 0, maximum: 100_000_000 },
          before_item_id: { type: 'string', minLength: 1, maxLength: 256 },
          limit: { type: 'integer', minimum: 1, maximum: 8 }
        }
      },
      run: async (input, context) => {
        const memory = getMemory()
        if (!memory) return failureResult('Chat memory is unavailable')
        const itemId = stringArg(input, 'item_id')
        if (input.offset !== undefined && !itemId) return usageResult('offset requires item_id')
        if (input.chat_id !== undefined && input.scope !== 'history') return usageResult('chat_id requires scope: history')
        const request: ChatRecallRequest = {
          scope: stringArg(input, 'scope') as ChatRecallRequest['scope'],
          chatId: stringArg(input, 'chat_id'),
          types: Array.isArray(input.types) ? (input.types as string[]) : undefined,
          query: stringArg(input, 'query'), itemId, offset: numberArg(input, 'offset', 0),
          beforeItemId: stringArg(input, 'before_item_id'), limit: numberArg(input, 'limit', 5)
        }
        return textResult(JSON.stringify(await memory.recall(context, request)))
      }
    })
  ]
}
