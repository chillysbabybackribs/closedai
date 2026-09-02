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
        description:
          'Take and inspect screenshots when visual evidence is needed. Choose app_window for the ' +
          'whole user-visible interface, browser_page for an isolated readiness-gated page, or crop ' +
          'to enlarge a region from an earlier capture. ' +
          `Every screenshot stays in the conversation for later turns, and at most ${budget.maxPerTurn} ` +
          'images are allowed per turn across all actions. Make a batch of changes, then capture once ' +
          'to verify the result; never capture after each small step. Whether an element exists or ' +
          'what it says comes from embedded_browser.page read_page, not a screenshot. On a wide window app_window is scaled down ' +
          'hard, so prefer browser_page for page content and crop for detail. ' +
          'When called from exec (code mode) the result is one string: the text summary followed by ' +
          'the image as a data: URL. Split it exactly like this and never pass the whole string to ' +
          'text(), which would dump the image as base64 text: ' +
          'const i = r.indexOf("data:image/"); text(r.slice(0, i)); image(r.slice(i));',
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
