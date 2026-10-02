import type { ReactNode } from 'react'
import { filePathFromViewTab, fileViewTitle, useFileViewTarget } from '../chat-layout/file-view-layout.js'
import { FileViewer } from './file-viewer.js'

/** A file view tab's body: the file named by the tab id, at the line or diff its last open asked for. */
export function FileView({ tabId, active }: { tabId: string; active: boolean }): ReactNode {
  const path = filePathFromViewTab(tabId)
  const target = useFileViewTarget(tabId)
  if (!path) return null
  return <section className="workspace-view" data-ui="view.file" data-ui-key={tabId} data-kind="file"
    aria-label={`${fileViewTitle(path)} file view`}>
    <div className="workspace-view-body">
      <FileViewer id={tabId} source="path" path={path} fileName={fileViewTitle(path)} active={active}
        revision={target.revision} line={target.line} endLine={target.endLine} diff={target.diff} cwd={target.cwd} />
    </div>
  </section>
}
