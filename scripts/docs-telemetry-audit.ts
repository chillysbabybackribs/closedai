/**
 * Report-only docs and tool-telemetry audit (see docs/reports/README.md).
 *
 * Usage: npm run audit:docs [-- --telemetry=/path/to/tool-telemetry.json]
 */
import { execSync, spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { appTools } from '../src/main/tools/app/index.ts'
import { batchTools } from '../src/main/tools/batch/index.ts'
import { browserTools } from '../src/main/tools/browser/index.ts'
import { captureTools } from '../src/main/tools/capture/index.ts'
import { TOOL_CATALOG } from '../src/main/tools/catalog.ts'
import { cdpTools } from '../src/main/tools/cdp/index.ts'
import { credentialVaultTools } from '../src/main/tools/credential-vault/index.ts'
import { createToolRegistry, type ToolRegistry } from '../src/main/tools/index.ts'
import { measureToolContextBudget } from '../src/main/tools/tool-context-budget.ts'
import { nativeInstrumentTools } from '../src/main/tools/native-instrument/index.ts'
import { mediaTools } from '../src/main/tools/media/index.ts'
import { notesTools } from '../src/main/tools/notes/index.ts'
import { peerChatTools } from '../src/main/tools/peer-chats/index.ts'
import { searchTools } from '../src/main/tools/search/index.ts'
import type { ResearchDependencies } from '../src/main/tools/search/research/service.ts'
import type { ToolTelemetrySnapshot, ToolStats } from '../src/shared/tools.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const reportsDir = path.join(root, 'docs/reports')

const CURRENT_GUIDES = [
  'docs/application.md',
  'docs/model-context.md',
  'docs/tools.md',
  'docs/cdp-tool-foundation.md',
  'docs/claude-code.md',
  'docs/antigravity.md',
  'docs/cursor.md',
  'docs/native-instrumentation.md',
  'docs/autogit.md',
  'AGENTS.md',
  'docs/README.md'
]

/** Retired model tools — mentions outside explicit retirement prose are stale. */
const LEGACY_TOOL_IDS = [
  'search.pdf',
  'search.library',
  'peer_chats.checkpoint',
  'investigation.read',
  'investigation.manage',
  'credential_vault.write',
  'closedai_workspace',
  'embedded_browser.network.body'
]

const RETIREMENT_CONTEXT = /retired|legacy|removed|was removed|no longer|no model-facing|Note:/i

type Finding = {
  section: string
  severity: string
  summary: string
  detail: string
}

type AuditContext = {
  registry: ToolRegistry
  switchable: Set<string>
  toolNames: Set<string>
  telemetry: ToolTelemetrySnapshot | null
  telemetrySource: string
  gitHead: string | null
  gitClean: boolean | null
  mapCheckOk: boolean | null
}

function stubHost(): null {
  return null
}

function minimalResearch(): ResearchDependencies {
  const document = {
    url: 'https://example.com/', title: 'x', text: 'x', contentType: 'text/plain',
    sha256: 'hash', incomplete: false, representation: 'static_text' as const
  }
  return {
    owner: (caller) => ({
      paneId: caller.paneId!, threadId: caller.threadId!, turnId: caller.turnId, workspace: root
    }),
    collect: async () => document,
    read: async () => document.text,
    remove: async () => {},
    openLive: () => 'tab-stub'
  }
}

function buildRegistry(): ToolRegistry {
  let registry!: ToolRegistry
  registry = createToolRegistry([
    nativeInstrumentTools(stubHost as never, () => false),
    credentialVaultTools(stubHost, stubHost),
    appTools(stubHost, stubHost),
    mediaTools({ app: stubHost, ui: stubHost, page: stubHost, record: stubHost as never }),
    browserTools(() => stubHost(), () => stubHost(), () => stubHost()),
    cdpTools(stubHost),
    captureTools(stubHost, stubHost as never),
    searchTools({ research: minimalResearch() }),
    peerChatTools(stubHost),
    notesTools({ store: stubHost, bindings: stubHost as never }),
    batchTools(() => registry, { maxCalls: 16 })
  ])
  return registry
}

function statKey(stat: ToolStats): string {
  return stat.action ? `${stat.toolId}.${stat.action}` : stat.toolId
}

async function loadTelemetry(explicitPath: string | null): Promise<{ snapshot: ToolTelemetrySnapshot | null; source: string }> {
  const candidates = [
    explicitPath,
    process.env.CLOSEDAI_TELEMETRY_PATH,
    path.join(homedir(), '.config/closedai/tool-telemetry.json')
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)

  for (const filePath of candidates) {
    try {
      const raw: unknown = JSON.parse(await readFile(filePath, 'utf8'))
      if (!raw || typeof raw !== 'object') continue
      const record = raw as Record<string, unknown>
      const snapshot: ToolTelemetrySnapshot = {
        stats: Array.isArray(record.stats) ? record.stats as ToolStats[] : [],
        totalCalls: typeof record.totalCalls === 'number' ? record.totalCalls : 0,
        since: typeof record.since === 'number' ? record.since : null,
        errors: Array.isArray(record.errors) ? record.errors as ToolTelemetrySnapshot['errors'] : []
      }
      return { snapshot, source: filePath }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
    }
  }
  return { snapshot: null, source: '(no telemetry file found)' }
}

function runMapCheck(): boolean {
  const result = spawnSync('npm', ['run', 'map:check'], { cwd: root, encoding: 'utf8' })
  return result.status === 0
}

function gitMeta(): { head: string | null; clean: boolean | null } {
  try {
    const head = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim()
    const status = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).trim()
    return { head, clean: status.length === 0 }
  } catch {
    return { head: null, clean: null }
  }
}

async function scanStaleLegacyClaims(files: string[]): Promise<Finding[]> {
  const findings: Finding[] = []
  for (const relative of files) {
    const text = await readFile(path.join(root, relative), 'utf8')
    for (const legacyId of LEGACY_TOOL_IDS) {
      if (!text.includes(legacyId)) continue
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes(legacyId)) continue
        if (RETIREMENT_CONTEXT.test(lines[i])) continue
        findings.push({
          section: 'Stale claims in current guides',
          severity: relative.startsWith('src/main/chat-context') ? 'model-facing' : 'maintainer-only',
          summary: `${relative}:${i + 1} mentions removed tool \`${legacyId}\``,
          detail: `Line does not read as an explicit retirement note. Registry has no \`${legacyId}\` in switchableIds().`
        })
      }
    }
    if (text.includes('src/main/tools/investigation/')) {
      findings.push({
        section: 'Stale claims in current guides',
        severity: 'maintainer-only',
        summary: `${relative} references removed path src/main/tools/investigation/`,
        detail: 'Investigation model tools were removed; artifact storage lives under src/main/investigations/.'
      })
    }
  }
  return findings
}

function catalogFindings(ctx: AuditContext): Finding[] {
  const findings: Finding[] = []
  const catalogKeys = new Set(Object.keys(TOOL_CATALOG))
  for (const name of ctx.toolNames) {
    if (!catalogKeys.has(name)) {
      findings.push({
        section: 'Missing or orphan documentation',
        severity: 'maintainer-only',
        summary: `Registered tool \`${name}\` missing from TOOL_CATALOG`,
        detail: 'Tools dialog falls back to generated labels (catalogEntry). Add an entry in src/main/tools/catalog.ts.'
      })
    }
  }
  for (const key of catalogKeys) {
    if (!ctx.toolNames.has(key)) {
      findings.push({
        section: 'Missing or orphan documentation',
        severity: 'maintainer-only',
        summary: `TOOL_CATALOG entry \`${key}\` has no registered tool`,
        detail: 'Remove or restore the tool definition in src/main/tools/.'
      })
    }
  }
  return findings
}

function mentionedInToolsMd(toolsMd: string, toolName: string): boolean {
  if (toolsMd.includes(toolName)) return true
  const dot = toolName.indexOf('.')
  if (dot <= 0) return false
  const namespace = toolName.slice(0, dot)
  const tool = toolName.slice(dot + 1)
  const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const row = new RegExp(`\\|\\s*\`${escaped(namespace)}\`\\s*\\|\\s*\`${escaped(tool)}\`\\s*\\|`)
  const combined = new RegExp(
    `\\|\\s*\`${escaped(namespace)}\`\\s*\\|\\s*\`[^|\`]*\\b${escaped(tool)}\\b[^|\`]*\`\\s*\\|`
  )
  if (row.test(toolsMd) || combined.test(toolsMd)) return true
  const namespaceMentioned =
    toolsMd.includes(`\`${namespace}\``) ||
    toolsMd.includes(`\`${namespace}.`) ||
    toolsMd.includes(`| \`${namespace}\` |`)
  if (!namespaceMentioned) return false
  return new RegExp(`\\b${escaped(tool)}\\b`).test(toolsMd)
}

async function toolsMdCoverage(ctx: AuditContext): Promise<Finding[]> {
  const toolsMd = await readFile(path.join(root, 'docs/tools.md'), 'utf8')
  const findings: Finding[] = []
  for (const name of ctx.toolNames) {
    if (!mentionedInToolsMd(toolsMd, name)) {
      findings.push({
        section: 'Missing or orphan documentation',
        severity: 'maintainer-only',
        summary: `\`docs/tools.md\` does not mention registered tool \`${name}\``,
        detail: 'Current guides should describe or cross-link every namespace.tool (table row or backtick id).'
      })
    }
  }
  return findings
}

function telemetryIdKnown(stat: ToolStats, ctx: AuditContext): boolean {
  const key = statKey(stat)
  if (ctx.switchable.has(key)) return true
  if (stat.action === null && ctx.toolNames.has(stat.toolId)) return true
  return false
}

function telemetryFindings(ctx: AuditContext): Finding[] {
  if (!ctx.telemetry) {
    return [{
      section: 'Tool telemetry — unused and failing',
      severity: 'maintainer-only',
      summary: 'No telemetry snapshot loaded',
      detail: `Expected file at ~/.config/closedai/tool-telemetry.json or pass --telemetry=PATH. Source: ${ctx.telemetrySource}`
    }]
  }
  const findings: Finding[] = []

  for (const toolName of ctx.toolNames) {
    const toolStat = ctx.telemetry.stats.find((row) => row.toolId === toolName && row.action === null)
    const toolCalls = toolStat?.calls ?? 0
    if (toolCalls > 0) continue
    const anyAction = ctx.telemetry.stats.some((row) => row.toolId === toolName && row.action && row.calls > 0)
    if (anyAction) continue
    findings.push({
      section: 'Tool telemetry — unused and failing',
      severity: 'maintainer-only',
      summary: `Zero calls for tool \`${toolName}\``,
      detail: ctx.telemetry.since
        ? `No tool-level or action-level calls since ${new Date(ctx.telemetry.since).toISOString()} (totalCalls=${ctx.telemetry.totalCalls}).`
        : 'No calls recorded in aggregate counters.'
    })
  }

  for (const stat of ctx.telemetry.stats) {
    const key = statKey(stat)
    if (!telemetryIdKnown(stat, ctx) && stat.calls > 0) {
      findings.push({
        section: 'Tool telemetry — unused and failing',
        severity: 'maintainer-only',
        summary: `Telemetry id \`${key}\` is not in current switchableIds (${stat.calls} calls)`,
        detail: 'Likely renamed or removed tool; counters may be stale until cleared.'
      })
    }
    if (stat.calls >= 5 && stat.failures + stat.timeouts + stat.misuses >= Math.ceil(stat.calls * 0.25)) {
      findings.push({
        section: 'Tool telemetry — unused and failing',
        severity: 'user-facing',
        summary: `High failure rate for \`${key}\` (${stat.failures} failures, ${stat.timeouts} timeouts, ${stat.misuses} misuses / ${stat.calls} calls)`,
        detail: 'Review recent error notes and tool descriptions.'
      })
    }
  }

  for (const note of ctx.telemetry.errors.slice(0, 8)) {
    const key = note.action ? `${note.toolId}.${note.action}` : note.toolId
    findings.push({
      section: 'Tool telemetry — unused and failing',
      severity: note.kind === 'misuse' ? 'maintainer-only' : 'user-facing',
      summary: `Recent ${note.kind} on \`${key}\``,
      detail: `${new Date(note.at).toISOString()}: ${note.message.slice(0, 240)}`
    })
  }

  return findings
}

async function readmeGuideFindings(): Promise<Finding[]> {
  const readme = await readFile(path.join(root, 'docs/README.md'), 'utf8')
  const findings: Finding[] = []
  const links = [...readme.matchAll(/\]\(([^)]+\.md)\)/g)].map((match) => match[1])
  const currentSection = readme.indexOf('## Current guides')
  const historicalSection = readme.indexOf('## Dated research')
  for (const link of links) {
    const index = readme.indexOf(link)
    if (currentSection >= 0 && index > currentSection && (historicalSection < 0 || index < historicalSection)) {
      const normalized = link.startsWith('../') ? path.join(root, link.slice(3)) : path.join(root, 'docs', link)
      try {
        await readFile(normalized, 'utf8')
      } catch {
        findings.push({
          section: 'Missing or orphan documentation',
          severity: 'maintainer-only',
          summary: `docs/README.md current-guide link missing on disk: ${link}`,
          detail: `Resolved path: ${normalized}`
        })
      }
    }
  }
  return findings
}

async function historicalDocFindings(): Promise<Finding[]> {
  const entries = await readdir(path.join(root, 'docs'), { withFileTypes: true })
  const markdown = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => entry.name)
  const currentBasenames = new Set(CURRENT_GUIDES.map((file) => path.basename(file)))
  currentBasenames.add('README.md')
  const findings: Finding[] = []
  for (const name of markdown.sort()) {
    if (currentBasenames.has(name)) continue
    const isDated = /\d{4}-\d{2}-\d{2}/.test(name) ||
      /research|recon|audit|benchmark|backlog|blueprint|plan/i.test(name)
    findings.push({
      section: 'Research and dated docs — historical classification',
      severity: 'maintainer-only',
      summary: `docs/${name} treated as ${isDated ? 'historical evidence' : 'review manually'}`,
      detail: isDated
        ? 'Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.'
        : 'Not in the current-guides table; confirm README classification.'
    })
  }
  return findings.slice(0, 12)
}

function followUps(all: Finding[]): Finding[] {
  if (all.length === 0) return []
  return [{
    section: 'Recommended follow-ups (non-binding)',
    severity: 'maintainer-only',
    summary: `${all.length} finding(s) recorded in this run`,
    detail: 'Address stale guide lines and telemetry outliers in separate human-reviewed edits; do not auto-commit doc fixes from the auditor.'
  }]
}

function renderReport(ctx: AuditContext, findings: Finding[], reportPath: string): string {
  const bySection = new Map<string, Finding[]>()
  for (const finding of findings) {
    const list = bySection.get(finding.section) ?? []
    list.push(finding)
    bySection.set(finding.section, list)
  }

  const sections = [
    'Metadata',
    'Stale claims in current guides',
    'Missing or orphan documentation',
    'Tool telemetry — unused and failing',
    'Research and dated docs — historical classification',
    'Recommended follow-ups (non-binding)'
  ]

  const lines: string[] = [
    '# Docs and tool-telemetry audit report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Command: `npm run audit:docs`',
    '',
    '',
    '## 1. Metadata',
    '',
    `- **Git HEAD:** ${ctx.gitHead ?? '(unavailable)'}`,
    `- **Working tree clean:** ${ctx.gitClean === null ? '(unknown)' : ctx.gitClean ? 'yes' : 'no'}`,
    `- **map:check:** ${ctx.mapCheckOk === null ? '(not run)' : ctx.mapCheckOk ? 'pass' : 'fail'}`,
    `- **Telemetry source:** ${ctx.telemetrySource}`,
    `- **Registry tool count:** ${ctx.toolNames.size} tools, ${ctx.switchable.size} switchable ids`,
    (() => {
      const budget = measureToolContextBudget(ctx.registry)
      const top = budget.eagerTools.slice(0, 3).map((row) => `${row.id} (${row.chars}c)`).join(', ')
      return `- **Codex eager tool wire:** ${budget.eagerWireChars} chars, ${budget.advertisedTokens} advertised tokens; top eager: ${top}`
    })(),
    `- **Report path:** ${path.relative(root, reportPath)}`,
    ''
  ]

  for (const title of sections.slice(1)) {
    lines.push(`## ${sections.indexOf(title) + 1}. ${title}`, '')
    const items = bySection.get(title) ?? []
    if (items.length === 0) {
      lines.push('_None found._', '')
      continue
    }
    for (const item of items) {
      lines.push(`- **${item.severity}** — ${item.summary}`, `  ${item.detail}`, '')
    }
  }

  return lines.join('\n')
}

function parseArgs(argv: string[]): { telemetryPath: string | null } {
  let telemetryPath: string | null = null
  for (const arg of argv) {
    if (arg.startsWith('--telemetry=')) telemetryPath = arg.slice('--telemetry='.length)
  }
  return { telemetryPath }
}

async function main(): Promise<void> {
  const { telemetryPath } = parseArgs(process.argv.slice(2))
  const registry = buildRegistry()
  const switchable = new Set(registry.switchableIds())
  const toolNames = new Set(registry.names())
  const { snapshot, source } = await loadTelemetry(telemetryPath)
  const { head, clean } = gitMeta()
  const mapCheckOk = runMapCheck()

  const ctx: AuditContext = {
    registry,
    switchable,
    toolNames,
    telemetry: snapshot,
    telemetrySource: source,
    gitHead: head,
    gitClean: clean,
    mapCheckOk
  }

  const findings: Finding[] = [
    ...await scanStaleLegacyClaims(CURRENT_GUIDES),
    ...catalogFindings(ctx),
    ...await toolsMdCoverage(ctx),
    ...telemetryFindings(ctx),
    ...await readmeGuideFindings(),
    ...await historicalDocFindings()
  ]
  findings.push(...followUps(findings))

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await mkdir(reportsDir, { recursive: true })
  const reportPath = path.join(reportsDir, `docs-telemetry-audit-${stamp}.md`)
  const body = renderReport(ctx, findings, reportPath)
  await writeFile(reportPath, body, 'utf8')

  const actionable = findings.filter((f) => f.section !== 'Research and dated docs — historical classification')
  console.log(`Wrote ${path.relative(root, reportPath)} (${actionable.length} primary findings)`)
  if (actionable.length < 3) {
    console.warn('Warning: fewer than three primary findings; check telemetry path and repo state.')
    process.exitCode = 1
  }
}

await main()
