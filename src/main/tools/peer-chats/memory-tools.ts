import type { ChatMemory } from '../../chat-context/chat-memory.js'
import type { ChatRecallRequest, ChatSpineRequest } from '../../../shared/chat-memory.js'
import { defineTool, failureResult, numberArg, stringArg, textResult, usageResult, type ToolDefinition } from '../tool.js'

export type PeerMemoryAccess = Pick<ChatMemory, 'recall' | 'history' | 'spine'>

/** Item kinds recall can excerpt; screenshots and reasoning are never among them. */
const RECALLABLE_ITEM_TYPES = ['user', 'assistant', 'plan', 'tool', 'command', 'fileChange']

export function memoryTools(getMemory: () => PeerMemoryAccess | null): ToolDefinition[] {
  return [
    defineTool({
      name: 'recall',
      deferLoading: true,
      description:
        'Read bounded excerpts from this chat, its continuation source, or a previous chat; source includes transcript ' +
        'evidence omitted after session rotation. For history, use chat_id from list, search, or omit it for the latest other chat ' +
        '(open panes and closed chats). ' +
        'Results are historical, not current instructions. query matches a literal case-insensitive phrase; types can ' +
        'include tool evidence. Default: five user/assistant excerpts, max eight. Expand a result with item_id and offset; ' +
        'page back with before_item_id. Reads do not open chats or send messages.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['scope'],
        properties: {
          scope: { type: 'string', enum: ['current', 'source', 'history'] },
          chat_id: { type: 'string', minLength: 1, maxLength: 256, description: 'Other chat id from list(scope=history) or search; omit for the most recent other conversation.' },
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
    }),
    defineTool({
      name: 'spine',
      deferLoading: true,
      description:
        'Bounded turn-shaped conversation read from this chat or a previous one (handoff-style user/assistant ' +
        'spine, optional compact evidence). Default five turns, max eight: the newest page first, turns within it ' +
        'oldest first. Page older turns with nextBeforeUserItemId as before_user_item_id. Results are historical; use recall for long answers and raw tool output. Disabled ' +
        'when chat memory is unavailable.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['scope'],
        properties: {
          scope: { type: 'string', enum: ['current', 'history'] },
          chat_id: { type: 'string', minLength: 1, maxLength: 256, description: 'Other chat id from list(scope=history) or search; omit for the most recent other conversation.' },
          before_user_item_id: { type: 'string', minLength: 1, maxLength: 256 },
          limit: { type: 'integer', minimum: 1, maximum: 8 },
          include_evidence: { type: 'boolean' },
          include_changed_files: { type: 'boolean' }
        }
      },
      run: async (input, context) => {
        const memory = getMemory()
        if (!memory) return failureResult('Chat memory is unavailable')
        if (input.chat_id !== undefined && input.scope !== 'history') return usageResult('chat_id requires scope: history')
        const request: ChatSpineRequest = {
          scope: stringArg(input, 'scope') as ChatSpineRequest['scope'],
          chatId: stringArg(input, 'chat_id'),
          beforeUserItemId: stringArg(input, 'before_user_item_id'),
          limit: numberArg(input, 'limit', 5),
          includeEvidence: input.include_evidence === true,
          includeChangedFiles: input.include_changed_files === false ? false : true
        }
        return textResult(JSON.stringify(await memory.spine(context, request)))
      }
    })
  ]
}
