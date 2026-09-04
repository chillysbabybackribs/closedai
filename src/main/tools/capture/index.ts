import { defineActionTool, type ToolAction } from '../action-tool.js'
import { failureResult, type ToolNamespace, type ToolResult } from '../tool.js'
import { appWindowAction } from './app-window.js'
import { browserPageAction } from './browser-page.js'
import { CaptureBudget } from './budget.js'
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
  budget = new CaptureBudget()
): ToolNamespace {
  const actions = [appWindowAction(capture, store), browserPageAction(capture, store), cropAction(capture, store)]
  return {
    name: 'closedai_ui',
    description: 'Visual access to the application window and its embedded browser pages.',
    tools: [
      defineActionTool({
        name: 'capture',
        deferLoading: true,
        description:
          'Screenshots when visual evidence is needed: app_window (whole UI), browser_page (one readiness-gated page), ' +
          'or crop (enlarge a retained region). At most ' +
          `${budget.maxPerTurn} images per turn; prefer embedded_browser.page read_page for text. ` +
          'Batch changes, then capture once. Exec mode: split the text summary from the data:image/ URL before text().',
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
      const first = result.content[0]
      if (result.content.some((item) => item.type === 'image') && first?.type === 'text') {
        first.text += `\nImages left this turn: ${use.remaining}`
      }
      return result
    }
  }
}
