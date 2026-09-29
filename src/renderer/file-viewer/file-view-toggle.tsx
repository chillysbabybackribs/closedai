import type { JSX } from 'react'
import { AppWindow, CodeXml } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group.js'
import type { FileView } from '../../shared/local-files.js'

/**
 * Page | Code for a local HTML or SVG tab. The same control sits in the web toolbar (page
 * showing) and the file viewer toolbar (code showing); main swaps the tab in place.
 */
export function FileViewToggle({ tabId, view, onError }: {
  tabId: string
  view: FileView
  onError: (reason: unknown) => void
}): JSX.Element {
  return (
    // Sizes sit on the group: the app's unlayered `button { font: inherit }` outranks utilities on buttons.
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={view}
      onValueChange={(next) => {
        if (next === 'page' || next === 'code') {
          if (next !== view) void window.closedai.localFiles.setView(tabId, next).catch(onError)
        }
      }}
      aria-label="File view"
      className="file-view-toggle text-xs"
    >
      <ToggleGroupItem value="page" className="h-7 gap-1 px-2" title="Show the page this file builds"
        data-ui="file.view" data-ui-key="page">
        <AppWindow aria-hidden="true" />Page
      </ToggleGroupItem>
      <ToggleGroupItem value="code" className="h-7 gap-1 px-2" title="Show the file's source"
        data-ui="file.view" data-ui-key="code">
        <CodeXml aria-hidden="true" />Code
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
