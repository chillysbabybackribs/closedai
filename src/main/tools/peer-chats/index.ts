import type { ChatIndexSearchRequest, ChatIndexSearchResult } from '../../../shared/chat-index.js'
import type { ChatPeerSummary, PeerChatReadOptions, PeerChatReadResult } from '../../../shared/chat-peers.js'
import { PEER_READ_DEFAULT_CHARS, PEER_READ_MAX_CHARS } from '../../../shared/chat-peers.js'
import { defineTool, failureResult, numberArg, stringArg, textResult, usageResult, type ToolNamespace, type ToolResult } from '../tool.js'
import { memoryTools, type PeerMemoryAccess } from './memory-tools.js'

/** Every transcript item type a peer may see; reasoning stays with the model that produced it. */
const READABLE_ITEM_TYPES = ['user', 'assistant', 'tool', 'command', 'fileChange', 'plan', 'notice', 'screenshot']

export type PeerChatDirectory = {
  memory?: PeerMemoryAccess
  searchIndex?(callerPaneId: string | null, request: ChatIndexSearchRequest): ChatIndexSearchResult
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
    description: 'Discover open and previous conversations and retrieve bounded excerpts.',
    tools: [
      defineTool({
        name: 'list',
        deferLoading: true,
        description:
          'scope open (default) lists live peer activity; paneId is chat_id for read. scope history discovers other chats ' +
          'in the store (open panes and closed) across projects, newest activity first, without transcripts. Returns up to ' +
          '8 entries (default limit 5). query matches titles, previews, project paths, and checkpoint notes, not transcript ' +
          'bodies; cwd narrows history to one project. Page with nextBeforeChatId as before_chat_id. Use recall(scope=history, ' +
          'chat_id=...) for transcript excerpts; read only for ids from scope open. Prefer explicit references over recency.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {
          scope: {
            type: 'string',
            enum: ['open', 'history'],
            description: 'open (default): live peer summaries only — do not pass query, cwd, before_chat_id, or limit. history: search the chat store across projects.'
          },
          query: { type: 'string', maxLength: 200, description: 'Requires scope: history. Matches titles, previews, paths, checkpoint notes — not transcript bodies.' },
          cwd: { type: 'string', minLength: 1, maxLength: 4096, description: 'Requires scope: history. Absolute project directory to narrow history.' },
          before_chat_id: { type: 'string', minLength: 1, maxLength: 256, description: 'Requires scope: history. Page older entries (before_chat_id from a prior page).' },
          limit: { type: 'integer', minimum: 1, maximum: 8, description: 'Requires scope: history. Default 5.' }
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
            return usageResult('query, cwd, before_chat_id, and limit require scope: history')
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
          const callerPaneId = context.paneId ?? null
          const misuse = readRefusal(directory, chatId, callerPaneId)
          if (misuse) return misuse
          const result = await directory.readReadable(chatId, callerPaneId, {
            cursor: numberArg(input, 'cursor', 0),
            limit: numberArg(input, 'limit', 30),
            order: stringArg(input, 'order', 'newest') === 'oldest' ? 'oldest' : 'newest',
            types: Array.isArray(input.types) ? (input.types as PeerChatReadOptions['types']) : undefined,
            maxChars: numberArg(input, 'max_chars', PEER_READ_DEFAULT_CHARS)
          })
          return result
            ? textResult(JSON.stringify(result))
            : failureResult(`Peer chat ${JSON.stringify(chatId)} is temporarily unreadable. Call list again; the pane may be closing.`)
        }
      }),
      defineTool({
        name: 'search',
        deferLoading: true,
        description:
          'Cross-chat phrase search over the global hot memory index (default: the 10 most recently active chats). ' +
          'Matches conversation spine text (user/assistant/plan and compact tool/command labels), not raw tool output. ' +
          'Results are historical; use recall(scope=history, chat_id=..., item_id=...) for depth. query is a required ' +
          'literal case-insensitive phrase. cwd optionally narrows hits to one project directory. limit defaults to 5, max 8. ' +
          'The calling chat is excluded from hits.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 200 },
            cwd: { type: 'string', minLength: 1, maxLength: 4096 },
            limit: { type: 'integer', minimum: 1, maximum: 8 }
          }
        },
        run: async (input, context) => {
          const directory = getDirectory()
          if (!directory?.searchIndex) return failureResult('Chat memory index is unavailable')
          const query = stringArg(input, 'query')
          if (!query) return usageResult('query is required')
          return textResult(JSON.stringify(directory.searchIndex(context.paneId ?? null, {
            query,
            cwd: stringArg(input, 'cwd'),
            limit: numberArg(input, 'limit', 5)
          })))
        }
      }),
      ...memoryTools(() => getDirectory()?.memory ?? null)
    ]
  }
}

function readRefusal(directory: PeerChatDirectory, chatId: string, callerPaneId: string | null): ToolResult | null {
  if (callerPaneId && chatId === callerPaneId) {
    return usageResult('Cannot read the calling chat through peer_chats.read. Use recall(scope=current) for this transcript.')
  }
  const readable = directory.listReadable(callerPaneId)
  if (!readable.some((peer) => peer.paneId === chatId)) {
    return usageResult(
      `Unknown peer chat ${JSON.stringify(chatId)}. Use list for open peers (paneId is chat_id), ` +
      'or list(scope=history) and recall(scope=history) for closed chats.'
    )
  }
  return null
}
