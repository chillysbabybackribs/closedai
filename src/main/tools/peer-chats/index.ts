import type { ChatPeerSummary, PeerChatReadResult } from '../../../shared/chat-peers.js'
import { defineTool, failureResult, numberArg, stringArg, textResult, type ToolNamespace } from '../tool.js'

export type PeerChatDirectory = {
  listReadable(callerPaneId: string | null): ChatPeerSummary[]
  readReadable(
    chatId: string,
    callerPaneId: string | null,
    cursor?: number,
    limit?: number
  ): PeerChatReadResult | null
}

export function peerChatTools(getDirectory: () => PeerChatDirectory | null): ToolNamespace {
  return {
    name: 'peer_chats',
    description: 'Read live status and transcripts from other peer and subagent chats. This namespace is read-only.',
    tools: [
      defineTool({
        name: 'list',
        description: 'List other live peer chats and their visible subagent chats, including running state and current activity.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        run: async (_input, context) => {
          const directory = getDirectory()
          if (!directory) return failureResult('Peer chats are not available')
          return textResult(JSON.stringify({ chats: directory.listReadable(context.paneId ?? null) }))
        }
      }),
      defineTool({
        name: 'read',
        description: 'Read a bounded page of transcript and live status from one peer or subagent chat returned by peer_chats.list.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['chat_id'],
          properties: {
            chat_id: { type: 'string', minLength: 1 },
            cursor: { type: 'number', minimum: 0 },
            limit: { type: 'number', minimum: 1, maximum: 100 }
          }
        },
        run: async (input, context) => {
          const directory = getDirectory()
          if (!directory) return failureResult('Peer chats are not available')
          const chatId = stringArg(input, 'chat_id')!
          const result = directory.readReadable(
            chatId,
            context.paneId ?? null,
            numberArg(input, 'cursor', 0),
            numberArg(input, 'limit', 50)
          )
          return result ? textResult(JSON.stringify(result)) : failureResult(`Unknown or unavailable peer chat: ${chatId}`)
        }
      })
    ]
  }
}
