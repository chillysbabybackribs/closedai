import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ToolRow } from './tool-row.js'
import type { ToolRowModel } from './tools-model.js'

function sampleRow(overrides: Partial<ToolRowModel> = {}): ToolRowModel {
  return {
    tool: {
      id: 'search.query',
      namespace: 'search',
      name: 'query',
      label: 'Web search',
      summary: 'Look things up',
      offEffect: 'No web search',
      description: 'Search providers',
      enabled: true,
      deferLoading: false,
      costTokens: 7,
      group: 'reads-web',
      timeoutMs: null,
      actions: [],
      fields: [],
      inputSchema: {}
    },
    stat: null,
    errors: [],
    suggestOff: false,
    note: '',
    flag: null,
    ...overrides
  }
}

test('an open tool row renders the overview actions automation can target', () => {
  const html = renderToStaticMarkup(createElement(ToolRow, {
    row: sampleRow(),
    effect: 'reads the web',
    open: true,
    now: Date.now(),
    since: null,
    onOpenChange: () => {},
    onToggle: () => {},
    onRepair: () => {}
  }))
  assert.match(html, /data-ui="tools\.schema" data-ui-key="search\.query"/)
  assert.match(html, /Show schema/)
  assert.match(html, /What the model reads/)
})

test('a closed tool row keeps detail actions out of the tree', () => {
  const html = renderToStaticMarkup(createElement(ToolRow, {
    row: sampleRow(),
    effect: 'reads the web',
    open: false,
    now: Date.now(),
    since: null,
    onOpenChange: () => {},
    onToggle: () => {},
    onRepair: () => {}
  }))
  assert.doesNotMatch(html, /data-ui="tools\.schema"/)
})
