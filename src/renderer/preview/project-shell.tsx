import { useMemo } from 'react'
import { Gem } from 'lucide-react'

import { ProjectWorkspace } from '../agent-workspace/project-workspace.js'
import { buildProjectCanvasFixture } from './project-canvas-fixture.js'

const PREVIEW_PROJECT_PANE = 'preview-project-root'

export function ProjectShellPreview({ canvasPhase = false }: { canvasPhase?: boolean }) {
  const canvasFixture = useMemo(() => (canvasPhase ? buildProjectCanvasFixture() : null), [canvasPhase])
  return <div className="project-preview-app">
    <header className="project-preview-appbar" aria-label="ClosedAI preview chrome">
      <div className="project-preview-brand"><Gem size={16} aria-hidden="true" /> ClosedAI</div>
      <nav aria-label="Application menus"><span>File</span><span>View</span><span>Agent</span><span>Developer</span></nav>
      <div className="project-preview-search">Search chats <kbd>Ctrl H</kbd></div>
      <div className="project-preview-window-controls" aria-hidden="true"><span>—</span><span>□</span><span>×</span></div>
    </header>
    <main className="project-preview-workspace">
      <ProjectWorkspace paneId={PREVIEW_PROJECT_PANE} canvasFixture={canvasFixture} />
    </main>
  </div>
}
