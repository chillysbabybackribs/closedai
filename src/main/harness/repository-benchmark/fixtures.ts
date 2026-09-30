import { runInNewContext } from 'node:vm'

export type RepairFixture = {
  id: string
  prompt: string
  target: string
  files: Record<string, string>
  oracle: string
}
const distractors = Object.fromEntries(Array.from({ length: 24 }, (_, index) => [
  `src/widgets/widget-${index}.cjs`, `// Widget ${index}: dock rendering and browser decorations.\nmodule.exports = { label: 'widget-${index}', visible: true }\n`
]))
export const REPAIR_FIXTURES: RepairFixture[] = [
  {
    id: 'empty-launch', target: 'src/layout/window-insertion.cjs',
    prompt: 'When I close all the chat windows and click Chats in the dock, nothing opens. Fix that so it opens the requested chat even with no existing windows. Preserve existing windows and do not reveal the browser. Work directly in this project and verify the behavior.',
    files: {
      ...distractors,
      'README.md': 'Workspace shell. The dock dispatches actions to layout operations. Modules use CommonJS.\n',
      'src/dock/actions.cjs': "const { insertWindow } = require('../layout/window-insertion.cjs')\nexports.openChat = (state, chat) => ({ ...state, windows: insertWindow(state.windows, chat) })\n",
      'src/layout/window-insertion.cjs': "// Insert a chat window without changing browser visibility.\nexports.insertWindow = (windows, chat) => {\n  const host = windows.find(w => w.kind === 'chat')\n  if (!host) return windows\n  return [...windows, { id: chat, kind: 'chat', minimized: false }]\n}\n",
      'src/layout/browser-state.cjs': "exports.initialBrowser = () => ({ visible: false })\n"
    },
    oracle: `const f = module.exports.insertWindow;
      const empty = []; const one = [{ id: 'a', kind: 'chat', minimized: true }];
      const view = [{ id: 'v', kind: 'notes' }];
      for (const source of [empty, one, view]) {
        const before = JSON.stringify(source); const result = f(source, 'new');
        if (JSON.stringify(source) !== before || result.length !== source.length + 1) throw Error('mutation or no insertion');
        if (JSON.stringify(result.slice(0, -1)) !== before) throw Error('existing windows changed');
        const added = result.at(-1); if (added.id !== 'new' || added.kind !== 'chat' || added.minimized !== false) throw Error('wrong window');
      }`
  },
  {
    id: 'history-order', target: 'src/history/order-records.cjs',
    prompt: 'The history search shows older conversations ahead of more recently updated ones. Make it show newest first without changing the original records array. Keep ties in their existing order. Find and fix the responsible code and verify it.',
    files: {
      ...distractors,
      'README.md': 'Workspace history. Search renders the order returned by the history selector. Modules use CommonJS.\n',
      'src/history/search.cjs': "const { orderRecords } = require('./order-records.cjs')\nexports.search = (records, query) => orderRecords(records.filter(r => r.title.includes(query)))\n",
      'src/history/order-records.cjs': "// Conversation ordering for history search.\nexports.orderRecords = records => records.sort((a, b) => a.updatedAt - b.updatedAt)\n",
      'src/history/render.cjs': "exports.render = records => records.map(r => r.title).join('\\n')\n"
    },
    oracle: `const source = [{ id: 'old', updatedAt: 1 }, { id: 'a', updatedAt: 9 }, { id: 'b', updatedAt: 9 }];
      const before = JSON.stringify(source); const result = module.exports.orderRecords(source);
      if (JSON.stringify(source) !== before) throw Error('input mutated');
      if (result.map(r => r.id).join(',') !== 'a,b,old') throw Error('wrong order');
      if (module.exports.orderRecords([]).length !== 0) throw Error('empty');`
  }
]

/** The oracle is harness-owned, never supplied to the agent. Evaluate a captured source snapshot. */
export function correctSnapshot(fixture: RepairFixture, files: Record<string, string>): boolean {
  if (Object.keys(files).sort().join('\0') !== Object.keys(fixture.files).sort().join('\0')) return false
  for (const [path, original] of Object.entries(fixture.files)) {
    if (path !== fixture.target && files[path] !== original) return false
  }
  try {
    const module = { exports: {} }
    runInNewContext(`${files[fixture.target]}\n${fixture.oracle}`, { module, exports: module.exports }, { timeout: 100 })
    return true
  } catch { return false }
}
