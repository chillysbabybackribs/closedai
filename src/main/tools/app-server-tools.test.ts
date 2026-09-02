import assert from 'node:assert/strict'
import test from 'node:test'
import { toolCallResponse } from './app-server-tools.js'

test('tool results preserve text and image content for the model', () => {
  assert.deepEqual(
    toolCallResponse({ content: [
        { type: 'text', text: 'Surface: application window' },
        { type: 'image', dataUrl: 'data:image/png;base64,cG5n' }
      ] }),
    {
      success: true,
      contentItems: [
      { type: 'inputText', text: 'Surface: application window' },
      { type: 'inputImage', imageUrl: 'data:image/png;base64,cG5n' }
      ]
    }
  )
})
