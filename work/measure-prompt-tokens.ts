import { createToolRegistry, appTools, browserTools, cdpTools, captureTools, credentialVaultTools, searchTools, batchTools } from '../src/main/tools/index.js'
import { peerChatTools } from '../src/main/tools/peer-chats/index.js'
import { nativeInstrumentTools } from '../src/main/tools/native-instrument/index.js'
import { dynamicToolSpecs } from '../src/main/tools/app-server-tools.js'

const any = (): any => null
let registry: any = null
registry = createToolRegistry([
  nativeInstrumentTools(any(), () => true),
  credentialVaultTools(() => null, () => null),
  appTools(() => null, () => null),
  browserTools(() => null, () => null, () => null),
  cdpTools(() => null, undefined),
  captureTools(() => null),
  searchTools({}),
  peerChatTools(() => null),
  batchTools(() => registry, { maxCalls: 16 })
])

const specs = dynamicToolSpecs(registry)
const tok = (s: string) => Math.ceil(s.length / 4)

let grandFull = 0, grandActual = 0, deferredCount = 0, toolCount = 0
const rows: any[] = []
for (const ns of specs) {
  let nsFull = 0, nsActual = 0
  const nsDesc = tok(ns.name + ns.description)
  for (const t of ns.tools) {
    toolCount++
    const full = tok(JSON.stringify({ name: `${ns.name}.${t.name}`, description: t.description, parameters: t.inputSchema }))
    const stub = Math.ceil(`${ns.name}.${t.name}`.length / 4) + 4
    const actual = t.deferLoading ? stub : full
    if (t.deferLoading) deferredCount++
    nsFull += full; nsActual += actual
    rows.push({ tool: `${ns.name}.${t.name}`, deferred: !!t.deferLoading, full, sent: actual })
  }
  grandFull += nsFull + nsDesc; grandActual += nsActual + nsDesc
  console.log(`${ns.name.padEnd(20)} tools=${String(ns.tools.length).padStart(2)}  nsDesc=${String(nsDesc).padStart(4)}  full=${String(nsFull).padStart(6)}  sent=${String(nsActual).padStart(6)}`)
}
console.log('---')
console.log(`namespaces=${specs.length} tools=${toolCount} deferred=${deferredCount}`)
console.log(`ALL-LOADED tokens : ${grandFull}`)
console.log(`AS-SENT tokens    : ${grandActual}`)
console.log(`raw JSON chars (codex dynamicTools payload): ${JSON.stringify(specs).length}`)
console.log('---- top 15 by full cost ----')
rows.sort((a, b) => b.full - a.full).slice(0, 15).forEach(r => console.log(`${String(r.full).padStart(5)} ${r.deferred ? 'deferred' : 'always  '} ${r.tool}`))
