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
    description: 'Discover open and previous conversations, retrieve bounded excerpts, and save optional working notes.',
    tools: [
      defineTool({
        name: 'list',
        description: 'scope open (default) lists peer activity; paneId is the chat_id for read. scope history discovers previous conversations across projects, including closed chats, newest user activity first. Returns up to 5 compact entries (max 8), without loading transcripts. query filters titles, previews, project paths, and saved notes by a literal case-insensitive phrase; it does not search transcript bodies. cwd optionally narrows to one project directory. Page with nextBeforeChatId as before_chat_id. Use recall(scope=history, chat_id=...) to read or search a transcript. Older explicit references take precedence over recency.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {
          scope: { type: 'string', enum: ['open', 'history'] },
          query: { type: 'string', maxLength: 200 },
          cwd: { type: 'string', minLength: 1, maxLength: 4096 },
          before_chat_id: { type: 'string', minLength: 1, maxLength: 256 },
          limit: { type: 'integer', minimum: 1, maximum: 8 }
        } },
        run: async (input, context) => {
          const directory = getDirectory()
          if (!directory) return failureResult('Peer chats are not available')
          if (input.scope === 'history') {
            if (!directory.memory) return failureResult('Chat memory is unavailable')
            return textResult(JSON.stringify(directory.memory.history(context, {
              query: stringArg(input, 'query'), cwd: stringArg(input, 'cwd'), beforeChatId: stringArg(input, 'before_chat_id'),
              limit: numberArg(input, 'limit', 5)
            })))
          }
          if (input.query !== undefined || input.cwd !== undefined || input.before_chat_id !== undefined || input.limit !== undefined) {
            return failureResult('query, cwd, before_chat_id, and limit require history scope')
          }
          return textResult(JSON.stringify({ chats: directory.listReadable(context.paneId ?? null) }))
        }
      }),
      defineTool({
        name: 'read',
        deferLoading: true,
        description:
          'Paginated transcript from peer_chats.list. Default: newest items within max_chars (clips long tool output). ' +
          'cursor pages back; order oldest follows forward; types filters item kinds. itemSource saved means a parked chat.',
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
