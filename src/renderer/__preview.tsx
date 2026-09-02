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

const items: ChatTranscriptItem[] = [
  {
    type: 'user',
    id: 'u1',
    turnId: 't1',
    text: 'we need to update the chat UI -- first the users message needs to use the full width of the chat and start on the left side -- then the models font color is very very off'
  },
  { type: 'reasoning', id: 'r1', turnId: 't1', text: 'Checking the existing test hooks so verification uses the real key-loading path.', streaming: false },
  {
    type: 'command',
    id: 'c1',
    turnId: 't1',
    command: 'rg -n "SEARCH_API_KEY" src/main',
    cwd: '/home/dp/Desktop/closedai',
    status: 'completed',
    output: 'src/main/tools/search.ts:14: const key = env.SEARCH_API_KEY',
    exitCode: 0
  },
  {
    type: 'command',
    id: 'c2',
    turnId: 't1',
    command: 'npm run test -- search',
    cwd: '/home/dp/Desktop/closedai',
    status: 'completed',
    output: 'ok 12 passed',
    exitCode: 0
  },
  {
    type: 'assistant',
    id: 'a1',
    turnId: 't1',
    phase: 'final_answer',
    streaming: false,
    text: [
      'All five providers answered a live probe, and no key material reached the output.',
      '',
      '## What changed',
      '',
      'The transcript now carries structure in two inks rather than one. Body copy sits a full step below the headings, so a long answer reads as sections instead of a slab.',
      '',
      '### Provider results',
      '',
      'Each provider was hit with a minimal-cost request through the app’s own key loader, so a pass here means the real path works.',
      '',
      '- **Brave** — answered in 240ms',
      '- **Exa** — answered in 512ms, `top_k` clamped to 5',
      '- **Tavily** — answered in 380ms',
      '',
      '##### Caveats',
      '',
      'Rate limits were not exercised. See `src/main/tools/search.ts` for the retry ladder.'
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
              <ChatTranscript items={items} activeTurnId={null} />
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
      <div />
    </aside>
    <div style={{ background: 'var(--chassis)' }} />
  </div>
)
