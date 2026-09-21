import { useEffect, useState } from 'react'
import { detectPreset, type ToolPreset } from './tools-model.js'

/**
 * The registry's preset as the shell sees it, kept current from tool events. The pane header
 * shows it while Read-only is active, so a chat that cannot act is visibly a chat that cannot act.
 */
export function useToolsPreset(): ToolPreset | null {
  const [preset, setPreset] = useState<ToolPreset | null>(null)
  useEffect(() => {
    let live = true
    const read = (): void => {
      window.closedai.tools.manifest()
        .then((manifest) => { if (live) setPreset(detectPreset(manifest)) })
        .catch(() => { if (live) setPreset(null) })
    }
    read()
    const unsubscribe = window.closedai.tools.onEvent((event) => {
      if (event.type === 'enabled' || event.type === 'changed') read()
    })
    return () => { live = false; unsubscribe() }
  }, [])
  return preset
}
