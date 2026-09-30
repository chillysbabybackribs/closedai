import { defineActionTool, type ToolAction } from '../action-tool.js'
import { failureResult, type ToolNamespace, type ToolResult } from '../tool.js'
import { appWindowAction } from './app-window.js'
import { browserPageAction } from './browser-page.js'
import { CaptureBudget } from './budget.js'
import { CaptureDedup } from './dedup.js'
import { cropAction } from './crop.js'
import type { UiCaptureHostProvider } from './host.js'
import { ScreenshotStore } from './screenshot-store.js'

export type { BrowserPageCapture, CapturedImage, ImageCrop, ModelImage, UiCaptureHost, UiCaptureHostProvider } from './host.js'
export { ScreenshotStore, type ScreenshotSurface, type StoredScreenshot } from './screenshot-store.js'
export { CaptureBudget, DEFAULT_MAX_CAPTURES_PER_TURN } from './budget.js'

/**
 * One visual-read tool; the action selects composed app state or deterministic page state.
 * `store` receives every full-resolution capture so the transcript can show it while the
 * model keeps only the scaled copy. `budget` caps images per turn across all three actions.
 */
export function captureTools(
  capture: UiCaptureHostProvider,
  store = new ScreenshotStore(),
  budget = new CaptureBudget(),
  dedup = new CaptureDedup()
): ToolNamespace {
  const actions = [
    appWindowAction(capture, store, dedup),
    browserPageAction(capture, store, dedup), cropAction(capture, store, dedup)
  ]
  return {
    name: 'closedai_ui',
    description: 'Visual access to the application window and its embedded browser pages.',
    tools: [
      defineActionTool({
        name: 'capture',
        deferLoading: true,
        description:
          'Screenshots when visual evidence is needed: action is required — app_window, browser_page, or crop. ' +
          `At most ${budget.maxPerTurn} distinct images per turn; pixel-identical back-to-back captures return text only (no duplicate transcript screenshot). ` +
          'Prefer embedded_browser.page read_page for text. Batch UI changes, reveal the changed area, then capture once. ' +
          'Another capture needs a relevant edit/state change, a failed capture, or a specific unresolved visual detail; use a retained crop for small detail. ' +
          'For preview UI verification, rebuild and confirm the running app loaded the update first. Do not assume auto-reload succeeded. ' +
          'If refresh is unavailable or the update cannot be confirmed, stop captures and report "Build passed; visual verification pending a manual app restart" (report build failures separately). ' +
          'Never poll for rebuild/reload completion with screenshots; chat screenshots can change the image without a feature change, defeating pixel deduplication.',
        actions: actions.map((action) => withBudget(action, budget))
      })
    ]
  }
}

function withBudget(action: ToolAction, budget: CaptureBudget): ToolAction {
  return {
    ...action,
    async run(input, context): Promise<ToolResult> {
      const use = budget.use(context.turnId)
      if (!use.allowed) {
        return failureResult(
          `Screenshot budget reached: ${budget.maxPerTurn} images have already been taken this turn. ` +
          'Verify remaining state with embedded_browser.page read_page or finish the turn ' +
          'and describe what still needs a visual check; the budget resets on the next turn.'
        )
      }
      const result = await action.run(input, context)
      const hasImage = result.content.some((item) => item.type === 'image')
      if (!hasImage) {
        budget.unclaim(context.turnId)
        return result
      }
      const first = result.content[0]
      if (first?.type === 'text') {
        first.text += `\nImages left this turn: ${use.remaining}`
      }
      return result
    }
  }
}
