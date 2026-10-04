import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'

import { ChatPaneFolderBar } from './chat-pane-folder-bar.tsx'

test('ChatPaneFolderBar is one trigger with folder name above the composer', () => {
  const html = renderToStaticMarkup(createElement(ChatPaneFolderBar, {
    cwd: '/home/dev/closedai',
    projectPath: '/home/dev/closedai',
    appCheckoutPath: '/home/dev/closedai',
    pending: false,
    disabled: false,
    onChooseProject: async () => {}
  }))
  assert.match(html, /chat-pane-folder-trigger/)
  assert.match(html, /data-ui="chat\.folder-choose"/)
  assert.match(html, />closedai</)
  assert.doesNotMatch(html, /This app/)
  assert.doesNotMatch(html, /Change/)
})

test('ChatPaneFolderBar tooltip mentions app checkout when folder differs', () => {
  const html = renderToStaticMarkup(createElement(ChatPaneFolderBar, {
    cwd: '/home/dev/shellio',
    projectPath: '/home/dev/shellio',
    appCheckoutPath: '/home/dev/closedai',
    pending: false,
    disabled: false,
    onChooseProject: async () => {}
  }))
  assert.match(html, /App checkout: \/home\/dev\/closedai/)
})
