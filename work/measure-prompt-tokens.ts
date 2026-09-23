import { createToolRegistry, appTools, browserTools, cdpTools, captureTools, credentialVaultTools, searchTools, batchTools } from '../src/main/tools/index.js'
import { peerChatTools } from '../src/main/tools/peer-chats/index.js'
import { nativeInstrumentTools } from '../src/main/tools/native-instrument/index.js'
import { dynamicToolSpecs } from '../src/main/tools/app-server-tools.js'

let registry: any = null
registry = createToolRegistry([
  nativeInstrumentTools(null as any, () => true),
  credentialVaultTools(() => null, () => null),
  appTools(() => null as any, () => null as any),
  browserTools(() => null as any, () => null as any, () => null as any),
  cdpTools(() => null as any, undefined),
  captureTools(() => null as any),
  // research tools (search.run / search.read) live in the same namespace in the real app
  searchTools({ research: { browser: () => null as any } as any }),
  peerChatTools(() => null),
  batchTools(() => registry, { maxCalls: 16 })
])

const specs = dynamicToolSpecs(registry)
const tok = (s: string) => Math.ceil(s.length / 4)
const full = (ns: string, t: any, prefix = (n: string, m: string) => `${n}.${m}`) =>
  tok(JSON.stringify({ name: prefix(ns, t.name), description: t.description, parameters: t.inputSchema }))
const stub = (ns: string, t: any) => Math.ceil(`${ns}.${t.name}`.length / 4) + 4

let nsDescTotal = 0, all = 0, codex = 0, claude = 0, cursor = 0, agy = 0, agyStub = 0
let nTools = 0, nDeferred = 0
console.log('namespace            tools  def  nsDesc   all-loaded   codex/claude-sent')
for (const ns of specs) {
  const d = tok(ns.name + ns.description); nsDescTotal += d
  let nsAll = 0, nsSent = 0
  for (const t of ns.tools) {
    nTools++
    const f = full(ns.name, t), s = stub(ns.name, t)
    nsAll += f
    nsSent += t.deferLoading ? s : f
    all += f
    codex += t.deferLoading ? s : f
    claude += t.deferLoading ? s : full(ns.name, t, (n, m) => `mcp__${n}__${m}`)
    cursor += full(ns.name, t, (n, m) => `mcp__${n}__${m}`)
    if (t.deferLoading) { nDeferred++; agyStub += s } else agy += full(ns.name, t, (n, m) => `mcp__${n}__${m}`)
  }
  console.log(`${ns.name.padEnd(20)} ${String(ns.tools.length).padStart(4)} ${String(ns.tools.filter((t:any)=>t.deferLoading).length).padStart(4)} ${String(d).padStart(7)} ${String(nsAll).padStart(12)} ${String(nsSent).padStart(19)}`)
}
console.log('---')
console.log(`namespaces=${specs.length} tools=${nTools} deferred=${nDeferred} namespace-description tokens=${nsDescTotal}`)
const line = (label: string, n: number) => console.log(`${label.padEnd(34)} ${String(n).padStart(7)} tokens`)
line('All tool schemas loaded', all + nsDescTotal)
line('Codex (deferred stubs)', codex + nsDescTotal)
line('Claude (mcp__ names, stubs)', claude + nsDescTotal)
line('Cursor (every tool, no defer)', cursor + nsDescTotal)
line('Antigravity (eager only + stubs)', agy + agyStub + nsDescTotal)
