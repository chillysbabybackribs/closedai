import React from 'react'
import { createRoot } from 'react-dom/client'
import { Composer } from './composer'
import './styles.css'

const params = new URLSearchParams(location.search)
const width = Number(params.get('width') ?? 600)
const height = Number(params.get('height') ?? 480)
const zoom = Number(params.get('zoom') ?? 1)
const running = params.get('mode') === 'running'
const noop = async () => {}
if (params.has('before')) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = '/.stacked-chat-before.css'
  document.head.append(link)
}
createRoot(document.getElementById('root')!).render(
  <div className="chat-layout-tile" data-selected="true" style={{ width, height }}>
    <header className="chat-layout-header">
      <div className="chat-layout-tabs"><div className="chat-layout-tab" data-active="true">
        <button role="tab"><span>Review the stacked conversation layout and composer</span></button>
      </div></div>
      <button aria-label="New chat">+</button>
    </header>
    <div className="chat-layout-content"><aside className={`chat-pane prompt-chat${params.has('empty') ? ' prompt-chat-composer-centered' : ''}`}>
      <div className="chat-zoom-surface" style={{ '--chat-zoom': zoom, '--chat-zoom-inverse': 1 / zoom } as React.CSSProperties}>
        <div className="prompt-chat-scroll"><div className="prompt-chat-content">
          {!params.has('empty') && <><div className="prompt-message-user-content">Make stacked chats easier to read.</div><p>The transcript should have room while model, project and send controls stay accessible.</p></>}
        </div></div>
        <Composer enabled running={running} paused={params.get('mode') === 'paused'}
          models={[]} selectedModel="gpt-6-astra-with-a-long-model-name" selectedReasoningEffort={null}
          contextUsage={null} provider="codex" planUsage={null} onRefreshPlanUsage={noop}
          onModelChange={noop} onReasoningEffortChange={noop} onSend={noop} onStop={noop}
          onResume={noop} onInspectContext={() => {}} onNewChat={() => {}}
          cwd="/workspace/a-long-project-name-to-check-overflow" projectPath="/workspace/a-long-project-name-to-check-overflow"
          recentProjects={[]} onChooseProject={noop} onSelectProject={noop} onClearProject={noop}
          activeTurnId={running ? 'qa-turn' : null} />
      </div>
    </aside></div>
  </div>
)
