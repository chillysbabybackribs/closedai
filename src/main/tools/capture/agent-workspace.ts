import type { ToolAction } from '../action-tool.js'
import { failureResult } from '../tool.js'
import type { UiCaptureHostProvider } from './host.js'
import { requireCaptureHost } from './host.js'
import { imageResult } from './result.js'
import type { ScreenshotStore } from './screenshot-store.js'

export function agentWorkspaceAction(capture: UiCaptureHostProvider, store: ScreenshotStore): ToolAction {
  return {
    action: 'agent_workspace',
    description:
      'Capture the agent workspace pane alone, cropped from the composed app window, without the rest of the ' +
      'chrome, chats, or browser. Fails if the pane is not currently open in the layout.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    async run(_input, context) {
      const result = await requireCaptureHost(capture).captureAgentWorkspace()
      if (!result) return failureResult('The application window is unavailable or could not produce a composed frame')
      if (!result.visible) {
        return failureResult(
          'The agent workspace pane is not open in the layout, so there are no pixels to capture. ' +
          'Open it first (closedai_app.ui control layout.agent-toggle), then capture again.'
        )
      }
      if (!result.image) {
        return failureResult(`The agent workspace pane produced an empty region${result.error ? `: ${result.error}` : ''}`)
      }
      return imageResult('Surface: agent workspace pane', result.image, 'agent_workspace', store, context.callId)
    }
  }
}
