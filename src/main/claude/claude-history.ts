import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk'
import type { ChatThreadSummary, ChatTranscriptItem } from '../../shared/chat.js'
import { firstLineOfUserMessage, stripContextBlocks } from '../../shared/chat-display.js'
import { claudeThreadId } from './claude-ids.js'
import type { ClaudeSdk } from './claude-sdk.js'
import { ClaudeTurnTranslator, type ClaudeTranslatorOptions } from './claude-stream.js'

// Claude threads live in the SDK's own session store (~/.claude/projects/<cwd>/…): the CLI
// writes every turn there, titles sessions itself, and can resume any of them. The app keeps no
// second history; it lists, replays, and tags that store. Archiving is a tag rather than a
// delete so the CLI's `/resume` still sees the session.

export const CLAUDE_ARCHIVED_TAG = 'closedai-archived'

const MAX_THREADS = 100

export function threadSummaryFromSession(info: SDKSessionInfo): ChatThreadSummary | null {
  if (!info.sessionId || info.tag === CLAUDE_ARCHIVED_TAG) return null
  const firstPrompt = info.firstPrompt?.trim() ?? ''
  const summary = info.summary?.trim() ?? ''
  // `summary` is the first prompt until the CLI has generated a title, so it is clipped like one.
  const title = info.customTitle?.trim() || firstLineOfUserMessage(firstPrompt || summary) || 'New chat'
  return {
    id: claudeThreadId(info.sessionId),
    title,
    preview: stripContextBlocks(firstPrompt || summary),
    createdAt: info.createdAt ?? info.lastModified,
    updatedAt: info.lastModified || info.createdAt || 0
  }
}

/** Sessions recorded for this workspace, newest first. */
export async function listClaudeThreads(sdk: Pick<ClaudeSdk, 'listSessions'>, cwd: string): Promise<ChatThreadSummary[]> {
  const sessions = await sdk.listSessions({ dir: cwd, limit: MAX_THREADS, includeProgrammatic: true })
  return sessions
    .flatMap((info) => { const summary = threadSummaryFromSession(info); return summary ? [summary] : [] })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function archiveClaudeThread(sdk: Pick<ClaudeSdk, 'tagSession'>, sessionId: string, cwd: string): Promise<void> {
  await sdk.tagSession(sessionId, CLAUDE_ARCHIVED_TAG, { dir: cwd })
}

/** The CLI's title for a session once it has generated one; null before that (the pane then shows the first message). */
export async function claudeThreadName(sdk: Pick<ClaudeSdk, 'getSessionInfo'>, sessionId: string, cwd: string): Promise<string | null> {
  const info = await sdk.getSessionInfo(sessionId, { dir: cwd })
  return info?.customTitle?.trim() || null
}

/** Rebuild a session's transcript from the store, in the app's own item vocabulary. */
export async function replayClaudeSession(
  sdk: Pick<ClaudeSdk, 'getSessionMessages'>,
  sessionId: string,
  options: Omit<ClaudeTranslatorOptions, 'turnId' | 'replay'>
): Promise<ChatTranscriptItem[]> {
  const messages = await sdk.getSessionMessages(sessionId, { dir: options.cwd })
  const translator = new ClaudeTurnTranslator({ ...options, turnId: null, replay: true })
  const items = new Map<string, ChatTranscriptItem>()
  for (const message of messages) {
    for (const op of translator.handle(message).ops) {
      if (op.type === 'item') items.set(op.item.id, op.item)
    }
  }
  return [...items.values()]
}

