import type { ChatSnapshot } from '../../shared/chat.js'
import { activitySteps } from '../activity-steps.js'
import { chatRunning } from '../chat-state.js'
import { isActivity } from '../transcript-rows.js'
import { feedToolPhrase } from './feed-phrase.js'

// The running feed the compact quick chat shows while a task drives the page: the latest turn's
// steps as one-line updates, newest last, then its reply once the turn ends. Pure, so the words
// are tested directly and the card only lays them out.

export type QuickChatFeedLine = { id: string; text: string; state: 'live' | 'done' | 'failed' }

export type QuickChatFeed = {
  status: 'idle' | 'working' | 'done' | 'failed' | 'paused'
  /** The latest steps, oldest first. */
  lines: QuickChatFeedLine[]
  /** What the model last said in the turn: its reply once finished, its commentary while working. */
  reply: string | null
}

const REPLY_CHARS = 280

export function quickChatFeed(snapshot: ChatSnapshot, limit = 3): QuickChatFeed {
  const items = snapshot.items
  let start = -1
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.type === 'user') { start = index; break }
  }
  if (start < 0) return { status: snapshot.pausedTurnId ? 'paused' : 'idle', lines: [], reply: null }
  const turn = items.slice(start + 1)
  const running = chatRunning(snapshot)
  const activity = turn.filter(isActivity)
  const lines: QuickChatFeedLine[] = activitySteps(activity, Date.now()).map((step, index) => {
    const state = step.phase === 'failed' ? 'failed' : step.phase === 'running' || step.phase === 'pending' ? 'live' : 'done'
    const text = feedToolPhrase(activity[index]!, state === 'live') ?? [step.verb, step.label].filter(Boolean).join(' ')
    return { id: step.id, text, state }
  })
  const thinking = running && turn.at(-1)?.type === 'reasoning'
  if (thinking) lines.push({ id: 'thinking', text: 'Thinking', state: 'live' })
  if (running && !lines.some((line) => line.state === 'live')) lines.push({ id: 'working', text: 'Working', state: 'live' })
  const failed = turn.some((item) => item.type === 'notice' && item.tone === 'error')
  const status = running ? 'working' : snapshot.pausedTurnId ? 'paused' : failed ? 'failed' : 'done'
  return { status, lines: lines.slice(-limit), reply: latestReply(turn) }
}

function latestReply(turn: ChatSnapshot['items']): string | null {
  for (let index = turn.length - 1; index >= 0; index -= 1) {
    const item = turn[index]!
    if (item.type === 'notice' && item.tone === 'error') return clip(item.text)
    if (item.type !== 'assistant') continue
    const text = clip(item.text)
    if (text) return text
  }
  return null
}

/** Markdown reduced to one plain paragraph for a two-line preview. */
function clip(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > REPLY_CHARS ? `${plain.slice(0, REPLY_CHARS - 1).trimEnd()}…` : plain
}
