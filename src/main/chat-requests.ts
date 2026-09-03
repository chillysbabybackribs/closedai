import type { ChatThreadSummary } from '../shared/chat.js'
import type { AppServerClient } from './app-server-client.js'
import { normalizeThreadSummaries } from './chat-normalizers.js'
import { ownThreadRows } from './chat-thread-origin.js'

// Stateless app-server calls the chat service exposes as-is; they need a connected client
// and nothing of the service's thread or turn state.

/** Threads this app recorded for this workspace, newest first. */
export async function listWorkspaceThreads(client: AppServerClient, cwd: string): Promise<ChatThreadSummary[]> {
  const response = await client.request<{ data?: unknown }>('thread/list', {
    cwd,
    sortKey: 'updated_at',
    sortDirection: 'desc',
    limit: 100,
    archived: false
  })
  // The store is shared with the Codex CLI and the Codex desktop app; their threads are not
  // this app's history, and a live one cannot be opened here at all — its owner holds the
  // writer lock, so resuming it fails with "already has an active writer".
  const rows = Array.isArray(response.data) ? response.data : []
  return normalizeThreadSummaries(await ownThreadRows(rows))
}

/** Begin a ChatGPT sign-in and return the URL the user must open. */
export async function startChatGptLogin(client: AppServerClient): Promise<string> {
  const response = await client.request<{ type?: unknown; authUrl?: unknown }>('account/login/start', {
    type: 'chatgpt',
    useHostedLoginSuccessPage: true,
    appBrand: 'chatgpt'
  })
  if (response.type !== 'chatgpt' || typeof response.authUrl !== 'string') {
    throw new Error('Codex did not return a ChatGPT sign-in URL')
  }
  return response.authUrl
}
