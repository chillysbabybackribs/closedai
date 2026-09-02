import { createRoot } from 'react-dom/client'

import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '../components/ui/message-scroller.js'
import type { ChatTranscriptItem } from '../shared/chat.js'
import { ChatTranscript } from './chat-transcript.js'
import './styles.css'

const command = (id: string, cmd: string, status = 'completed', exitCode: number | null = 0): ChatTranscriptItem => ({
  type: 'command',
  id,
  turnId: 't1',
  command: cmd,
  cwd: '/home/dp/Desktop/closedai',
  status,
  output: 'AGENTS.md\nREADME.md\npackage.json\n',
  exitCode
})

const items: ChatTranscriptItem[] = [
  { type: 'user', id: 'u1', turnId: 't1', text: 'how many tools do you have' },
  {
    type: 'assistant',
    id: 'a1',
    turnId: 't1',
    phase: 'commentary',
    streaming: false,
    text: 'The repository has five project-authored documentation files plus the README. Next I’m checking each document’s claims against the current entry points, IPC contracts, and tool registry.'
  },
  command('c1', 'rg --files -g "*.md"'),
  command('c2', 'npm run typecheck', 'failed', 1),
  {
    type: 'assistant',
    id: 'a2',
    turnId: 't1',
    phase: 'commentary',
    streaming: false,
    text: 'I’ve found the main drift: the implementation now has six tool namespaces, but the README describes only part of that surface.'
  },
  command('c3', 'npm run hygiene'),
  command('c4', 'npm test'),
  command('c5', 'npm run closure'),
  {
    type: 'assistant',
    id: 'a3',
    turnId: 't1',
    phase: 'final_answer',
    streaming: false,
    text: [
      '## Result',
      '',
      'The completion gate now passes. Body copy sits a step below the headings so a long answer reads as sections.',
      '',
      'See `src/main/tools/registry.ts` for the namespace list.'
    ].join('\n')
  }
]

createRoot(document.getElementById('root') as HTMLElement).render(
  <div style={{ height: '100vh', display: 'grid', gridTemplateColumns: '560px 1fr' }}>
    <aside className="chat-pane prompt-chat" data-ui-surface="chat">
      <div />
      <MessageScrollerProvider autoScroll={false} defaultScrollPosition="start">
        <MessageScroller className="chat-scroll-root prompt-chat-scroll">
          <MessageScrollerViewport className="chat-scroll">
            <MessageScrollerContent className="chat-scroll-content gap-0">
              <ChatTranscript items={items} />
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
      <div />
    </aside>
    <div style={{ background: 'var(--chassis)' }} />
  </div>
)
