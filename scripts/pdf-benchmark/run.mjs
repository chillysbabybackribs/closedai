// A small diagnostic benchmark, not a correctness gate or a representative accuracy estimate.
// node scripts/pdf-benchmark/run.mjs /absolute/output/directory [repetitions=3] [--rescore | --case=id]
import { build } from 'esbuild'
import electron from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { cases, sources } from './cases.mjs'

const filename = fileURLToPath(import.meta.url)
const project = resolve(dirname(filename), '../..')
const output = resolve(process.argv[2] ?? '/tmp/closedai-pdf-benchmark-results')
const repetitions = Number(process.argv[3] ?? 3)
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error('Repetitions must be 1–10')
const selectedId = process.argv.find((arg) => arg.startsWith('--case='))?.slice(7)
const selectedCases = selectedId ? cases.filter((test) => test.id === selectedId) : cases
if (!selectedCases.length) throw new Error(`Unknown case: ${selectedId}`)

if (!process.versions.electron) {
  const code = await new Promise((done, reject) => {
    const child = spawn(electron, [filename, output, String(repetitions), ...process.argv.slice(4)], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code) => done(code ?? 1))
  })
  process.exit(code)
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const normalize = (text) => text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'")
  .replace(/(?<!\p{L})'|'(?!\p{L})/gu, ' ')
  .replace(/[^\p{L}\p{N}']+/gu, ' ').trim().replace(/\s+/g, ' ')
function wordErrorRate(expected, actual) {
  const a = normalize(expected).split(' ')
  const b = normalize(actual) ? normalize(actual).split(' ') : []
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = next
  }
  return { expectedWords: a.length, edits: previous[b.length], rate: previous[b.length] / a.length }
}
function score(test, text, allowWer) {
  const normalized = ` ${normalize(text)} `
  const contains = (probe) => normalized.includes(` ${normalize(probe)} `)
  const positions = test.orderedAnchors?.map((anchor) => normalized.indexOf(` ${normalize(anchor)} `))
  return {
    probes: test.probes?.map((text) => ({ text, found: contains(text) })),
    anchorPositions: positions,
    anchorsOrdered: positions ? positions.every((n, i) => n >= 0 && (i === 0 || n > positions[i - 1])) : undefined,
    wer: allowWer && test.expectedText ? wordErrorRate(test.expectedText, text) : undefined
  }
}
function timings(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return { samplesMs: values, medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, minMs: sorted[0], maxMs: sorted.at(-1) }
}
async function worker(entry, data) {
  const started = performance.now()
  const thread = new Worker(pathToFileURL(entry), { workerData: data, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 256 } })
  let timer
  try {
    const result = await new Promise((done, reject) => {
      timer = setTimeout(() => reject(new Error('Worker exceeded 60 seconds')), 60_000)
      thread.once('error', reject)
      thread.once('exit', (code) => reject(new Error(`Worker exited before response: ${code}`)))
      thread.once('message', (message) => message.error ? reject(new Error(message.error)) : done(message.result))
    })
    return { result, elapsedMs: Math.round(performance.now() - started) }
  } finally { clearTimeout(timer); await thread.terminate() }
}

const normalization = 'NFKC, lowercase, curly apostrophes normalized, apostrophes retained only inside words, other punctuation replaced with spaces, whitespace collapsed. WER is word-level Levenshtein distance/reference words; punctuation/math fidelity is not measured by WER.'
if (process.argv.includes('--rescore')) {
  const report = JSON.parse(await readFile(join(output, 'results.json'), 'utf8'))
  report.normalization = normalization
  report.rescoredAt = new Date().toISOString()
  for (const row of report.cases) {
    const test = cases.find((test) => test.id === row.id)
    row.pageNumber = test.page
    for (const action of ['page', 'ocr']) {
      const evidence = JSON.parse(await readFile(join(output, `${test.id}-${action}.json`), 'utf8'))
      row[action].score = score(test, action === 'ocr' ? evidence.ocr.text : evidence.native.text, action === 'ocr' || !test.crop)
    }
  }
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2))
  console.log('Rescored saved evidence; no PDF workers or network requests ran.')
  process.exit(0)
}

await mkdir(output, { recursive: true })
await mkdir(join(project, 'out'), { recursive: true })
const bundle = await mkdtemp(join(project, 'out/pdf-benchmark-'))
const report = {
  measuredAt: new Date().toISOString(), repetitions,
  environment: { electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model },
  method: 'Fresh disposable worker for each sample; timings include worker startup and local rendering/OCR, exclude download/build/queue/cache. Native timing is whole-document; page/OCR timing is selected region.',
  normalization,
  sources: {}, cases: []
}
try {
  await build({
    entryPoints: {
      native: join(project, 'src/main/tools/search/research/pdf/pdf-worker.ts'),
      page: join(project, 'src/main/tools/search/research/pdf/page-worker.ts'),
      fixtures: join(project, 'src/main/tools/search/research/pdf/fixtures.test-helpers.ts')
    },
    outdir: bundle, outExtension: { '.js': '.mjs' }, bundle: true, packages: 'external', platform: 'node', format: 'esm'
  })
  report.workerHashes = Object.fromEntries(await Promise.all(['native', 'page'].map(async (name) => [name, sha256(await readFile(join(bundle, `${name}.mjs`)))])))
  const { pdfFixture } = await import(pathToFileURL(join(bundle, 'fixtures.mjs')).href)
  for (const [id, source] of Object.entries(sources)) {
    if (!selectedCases.some((test) => test.source === id)) continue
    const path = join(output, `${id}.pdf`)
    let bytes
    if (source.fixture) bytes = pdfFixture(source.fixture)
    else {
      try { bytes = await readFile(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (!bytes) {
        const response = await fetch(source.url, { signal: AbortSignal.timeout(30_000) })
        if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`)
        bytes = new Uint8Array(await response.arrayBuffer())
      }
      if (sha256(bytes) !== source.sha256) throw new Error(`${id}: source bytes changed; review before updating ground truth`)
    }
    await writeFile(path, bytes)
    const samples = []
    let native
    for (let i = 0; i < repetitions; i++) {
      const measured = await worker(join(bundle, 'native.mjs'), { path, maxTextChars: 0 })
      samples.push(measured.elapsedMs); native = measured.result
    }
    await writeFile(join(output, `${id}-native.txt`), native.text)
    report.sources[id] = { ...source, documentSha256: sha256(bytes), bytes: bytes.length, nativeTiming: timings(samples), coverage: native.pdf }
  }
  for (const test of selectedCases) {
    const row = { id: test.id, source: test.source, pageNumber: test.page, crop: test.crop, manualChecks: test.manualChecks }
    for (const action of ['page', 'ocr']) {
      const samples = []
      const outputHashes = []
      let evidence
      for (let i = 0; i < repetitions; i++) {
        const measured = await worker(join(bundle, 'page.mjs'), {
          path: join(output, `${test.source}.pdf`), documentSha256: report.sources[test.source].documentSha256,
          request: { action, page: test.page, dpi: action === 'ocr' ? 216 : 144, crop: test.crop }
        })
        samples.push(measured.elapsedMs); evidence = measured.result
        outputHashes.push(sha256(JSON.stringify(evidence)))
      }
      row[action] = {
        timing: timings(samples), repeatIdentical: new Set(outputHashes).size === 1,
        width: evidence.width, height: evidence.height, effectiveDpi: evidence.effectiveDpi,
        renderIncomplete: evidence.renderIncomplete,
        confidence: evidence.ocr?.confidence, engine: evidence.ocr?.engine,
        nativeChars: evidence.native.text.length,
        score: score(test, action === 'ocr' ? evidence.ocr.text : evidence.native.text, action === 'ocr' || !test.crop)
      }
      if (evidence.image) {
        await writeFile(join(output, `${test.id}.jpg`), Buffer.from(evidence.image.split(',')[1], 'base64'))
        delete evidence.image
      }
      await writeFile(join(output, `${test.id}-${action}.json`), JSON.stringify(evidence, null, 2))
    }
    report.cases.push(row)
    await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(row))
  }
} finally { await rm(bundle, { recursive: true, force: true }) }
console.log(`Results: ${join(output, 'results.json')}`)
