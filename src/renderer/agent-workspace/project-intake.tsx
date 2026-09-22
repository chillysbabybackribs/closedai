import { Boxes, Check, Compass, FlaskConical, RefreshCw, Sparkles } from 'lucide-react'

import type { ChatTranscriptItem } from '../../shared/chat.js'
import { AgentWorkspaceTranscript } from '../agent-workspace/agent-workspace-transcript.js'
import { clarityItems, clip, type DirectionRecord } from './project-discovery.js'

export type Message = { id: number | string; at: number; role: 'user' | 'coordinator'; text: string }

export function isInterruptedUserMessage(text: string): boolean {
  return /^\[Request interrupted.*\]$/i.test(text.trim())
}

export function transcriptItemsToMessages(items: ChatTranscriptItem[]): Message[] {
  const result: Message[] = []
  for (const item of items) {
    if (item.type === 'user') {
      if (!isInterruptedUserMessage(item.text)) {
        result.push({
          id: item.id,
          at: Date.now(),
          role: 'user',
          text: item.text
        })
      }
    } else if (item.type === 'assistant') {
      if (item.text.length > 0) {
        result.push({
          id: item.id,
          at: item.createdAt ?? Date.now(),
          role: 'coordinator',
          text: item.text
        })
      }
    }
  }
  return result
}

const SUGGESTIONS = [
  {
    title: 'Build a new product',
    detail: 'Start with an idea and let the application take shape through working iterations.',
    prompt: 'I want to build a new product. Help me turn the rough idea into a working application that we can keep shaping as it develops.',
    icon: Sparkles
  },
  {
    title: 'Evolve this codebase',
    detail: 'Understand what exists, then improve it without freezing the destination too early.',
    prompt: 'I want to evolve this existing codebase. First understand how it works, then begin improving it while keeping the direction open to what we learn.',
    icon: RefreshCw
  },
  {
    title: 'Research and prototype',
    detail: 'Investigate the space, test promising directions, and build something concrete.',
    prompt: 'Research this product space and build a working prototype. Use what we discover to continuously refine the direction.',
    icon: FlaskConical
  },
  {
    title: 'Modernize a system',
    detail: 'Repair, simplify, and migrate an application while preserving useful behavior.',
    prompt: 'Help me modernize this system. Preserve what is valuable, find the real constraints, and improve it in safe working increments.',
    icon: Boxes
  }
] as const

export function MessageText({ id, text }: { id: number | string; text: string }) {
  return <>{text.split('\n').map((line, index) => line
    ? <p key={`${id}-${index}`}>{line}</p>
    : <span key={`${id}-${index}`} className="project-message-break" />)}</>
}

export function ProjectIntake(props: {
  messages: Message[]
  sending: boolean
  record: DirectionRecord
  ready: boolean
  onSuggestion: (prompt: string) => void
  onStart: () => void
  /** Live agent chat: same transcript UI as ordinary chat panes. */
  transcript?: {
    paneId: string
    items: ChatTranscriptItem[]
    activeTurnId: string | null
    running: boolean
  }
  /** Full-viewport project preview only; hidden in the integrated agent workspace column. */
  showDirectionRecord?: boolean
}) {
  const { messages, sending, record, ready, onSuggestion, onStart, transcript, showDirectionRecord = true } = props
  const hasTranscript = Boolean(transcript && transcript.items.length > 0)

  if (!messages.length && !hasTranscript) {
    return <div className="project-shell-landing">
      <div className="project-shell-intro">
        <span className="project-shell-intro-mark"><Compass size={21} aria-hidden="true" /></span>
        <h1>What should we build?</h1>
        <p>Start rough. The coordinator will not start building until the idea is clear.</p>
      </div>
      <div className="project-suggestion-grid" aria-label="Starting suggestions">
        {SUGGESTIONS.map(({ title, detail, prompt, icon: Icon }) =>
          <button key={title} type="button" className="project-suggestion-card"
            data-ui="agent.project-suggestion" data-ui-key={title}
            onClick={() => onSuggestion(prompt)}>
            <span className="project-suggestion-icon"><Icon size={16} aria-hidden="true" /></span>
            <span><strong>{title}</strong><small>{detail}</small></span>
          </button>)}
      </div>
    </div>
  }

  const busy = transcript?.running ?? sending

  return <div className={`project-intake${showDirectionRecord ? '' : ' project-intake-single'}`}>
    <div className={`project-conversation${transcript ? ' project-conversation-live' : ''}`}>
      {transcript
        ? <AgentWorkspaceTranscript
            paneId={transcript.paneId}
            items={transcript.items}
            activeTurnId={transcript.activeTurnId}
            running={transcript.running}
          />
        : messages.map((message) => <article key={message.id} className={`project-message is-${message.role}`}>
          <div className="project-message-author">
            {message.role === 'user' ? 'You' : <><Compass size={13} aria-hidden="true" /> Root coordinator</>}
          </div>
          <MessageText id={message.id} text={message.text} />
        </article>)}
      {!transcript && sending && <div className="project-coordinator-thinking" role="status">
        <span /><span /><span /> Understanding the direction
      </div>}
      {showDirectionRecord && ready && !busy && <div className="project-start-row">
        <div><strong>Direction record complete</strong><span>Correct anything above, or begin with this understanding.</span></div>
        <button type="button" data-ui="agent.project-start" onClick={onStart}>Start building</button>
      </div>}
    </div>

    {showDirectionRecord && <aside className="project-clarity" aria-label="Direction record">
      <strong>Direction record</strong>
      <ol>
        {clarityItems(record).map((item) => <li key={item.slot} data-captured={item.captured || undefined}>
          <span className="project-clarity-mark" aria-hidden="true">{item.captured && <Check size={10} />}</span>
          <span className="project-clarity-text">
            <b>{item.label}</b>
            {item.value && <small>{clip(item.value, 96)}</small>}
          </span>
        </li>)}
      </ol>
      {record.unknowns.length > 0 && <div className="project-clarity-unknowns">
        <span>Open unknowns</span>
        {record.unknowns.map((unknown) => <small key={unknown}>{clip(unknown, 84)}</small>)}
      </div>}
      <p>{ready ? 'Complete. Start when it reads right.' : 'Start unlocks when every line is captured.'}</p>
    </aside>}
  </div>
}
