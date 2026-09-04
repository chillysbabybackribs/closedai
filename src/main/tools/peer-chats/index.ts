import type { ChatPeerSummary, PeerChatReadOptions, PeerChatReadResult } from '../../../shared/chat-peers.js'
import { PEER_READ_DEFAULT_CHARS, PEER_READ_MAX_CHARS } from '../../../shared/chat-peers.js'
import { defineTool, failureResult, numberArg, stringArg, textResult, type ToolNamespace } from '../tool.js'
import { memoryTools, type PeerMemoryAccess } from './memory-tools.js'

/** Every transcript item type a peer may see; reasoning stays with the model that produced it. */
const READABLE_ITEM_TYPES = ['user', 'assistant', 'tool', 'command', 'fileChange', 'plan', 'notice', 'screenshot']

export type PeerChatDirectory = {
  memory?: PeerMemoryAccess
  listReadable(callerPaneId: string | null): ChatPeerSummary[]
  readReadable(
    chatId: string,
    callerPaneId: string | null,
    options: PeerChatReadOptions
  ): Promise<PeerChatReadResult | null>
}

export function peerChatTools(getDirectory: () => PeerChatDirectory | null): ToolNamespace {
  return {
    name: 'peer_chats',
    description: 'Read peer status and bounded historical evidence. The separate checkpoint tool only writes the caller’s working notes; no tool here starts or controls agents.',
    tools: [
      defineTool({
        name: 'list',
        description: 'List other open peer chats and their visible subagent chats, including running state and current activity. Each entry’s paneId is the chat’s stable id (it survives the chat being parked or reopened) and is the chat_id for peer_chats.read.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        run: async (_input, context) => {
          const directory = getDirectory()
          if (!directory) return failureResult('Peer chats are not available')
          return textResult(JSON.stringify({ chats: directory.listReadable(context.paneId ?? null) }))
        }
      }),
      defineTool({
        name: 'read',
        description: 'Read a page of transcript and live status from one peer or subagent chat returned by peer_chats.list. Defaults to the newest end — what that chat is doing now or just concluded — inside a serialized character budget, clipping long tool output rather than returning a transcript the serializer has to cut blind. `cursor` pages further back from there (use the returned nextCursor), `order: "oldest"` follows a chat forward from its first message instead, and `types` narrows to the item kinds you need (["user","assistant"] drops tool traffic). `totalItems` is how many readable items match the filter, and `itemSource: "saved"` means the chat is parked, so its newest items come from the app’s saved tail and the conversation reaches further back than the page shows.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['chat_id'],
          properties: {
            chat_id: { type: 'string', minLength: 1 },
            cursor: { type: 'number', minimum: 0 },
            limit: { type: 'number', minimum: 1, maximum: 100 },
            order: { type: 'string', enum: ['newest', 'oldest'] },
            types: { type: 'array', maxItems: 8, items: { type: 'string', enum: READABLE_ITEM_TYPES } },
            max_chars: { type: 'number', minimum: 500, maximum: PEER_READ_MAX_CHARS }
          }
        },
        run: async (input, context) => {
          const directory = getDirectory()
          if (!directory) return failureResult('Peer chats are not available')
          const chatId = stringArg(input, 'chat_id')!
          const result = await directory.readReadable(chatId, context.paneId ?? null, {
            cursor: numberArg(input, 'cursor', 0),
            limit: numberArg(input, 'limit', 30),
            order: stringArg(input, 'order', 'newest') === 'oldest' ? 'oldest' : 'newest',
            types: Array.isArray(input.types) ? (input.types as PeerChatReadOptions['types']) : undefined,
            maxChars: numberArg(input, 'max_chars', PEER_READ_DEFAULT_CHARS)
          })
          return result ? textResult(JSON.stringify(result)) : failureResult(`Unknown or unavailable peer chat: ${chatId}`)
        }
      }),
      ...memoryTools(() => getDirectory()?.memory ?? null)
    ]
  }
}
