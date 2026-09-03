/** Turn a shell command into a short process-line phrase. Raw argv stays in expanded details. */

export type CommandKind = 'read' | 'search' | 'list' | 'edit' | 'git' | 'test' | 'run'

const FLAGS_WITH_VALUE = new Set([
  '-A', '-B', '-C', '-d', '-e', '-f', '-g', '-m', '-t', '-T', '-j',
  '--glob', '--type', '--type-add', '--type-not', '--regexp', '--file',
  '--max-count', '--max-depth', '--max-filesize', '--max-columns',
  '--ignore-file', '--path-separator'
])

export function commandPhrase(command: string, running = false): string {
  const stage = firstStage(unwrapShell(command))
  const argv = tokenize(stage)
  const verb = fileName(argv[0] ?? '').toLowerCase()
  const args = argv.slice(1)
  if (verb === 'sed' || verb === 'cat' || verb === 'bat' || verb === 'head' || verb === 'tail' || verb === 'nl' || verb === 'less' || verb === 'more') {
    return readPhrase(args, verb, running)
  }
  if (verb === 'rg' || verb === 'grep' || verb === 'ag' || verb === 'ack') return searchPhrase(args, running)
  if (verb === 'ls' || verb === 'tree' || verb === 'find' || verb === 'fd') return listPhrase(args, verb, running)
  if (verb === 'git') return gitPhrase(args, running)
  if (verb === 'npm' || verb === 'pnpm' || verb === 'yarn' || verb === 'bun') return packagePhrase(verb, args, running)
  if (verb === 'pwd') return running ? 'Checking directory' : 'Checked directory'
  if (verb === 'wc') return running ? 'Counting lines' : 'Counted lines'
  if (verb === 'mkdir' || verb === 'touch' || verb === 'cp' || verb === 'mv' || verb === 'rm') {
    const files = positionals(args)
    if (verb === 'mkdir') return files[0] ? `${running ? 'Creating' : 'Created'} ${fileName(files[0])}` : (running ? 'Creating directory' : 'Created directory')
    if (verb === 'touch') return files[0] ? `${running ? 'Creating' : 'Created'} ${fileName(files[0])}` : (running ? 'Creating file' : 'Created file')
    if (verb === 'cp') return files.at(-1) ? `${running ? 'Copying to' : 'Copied to'} ${fileName(files.at(-1)!)}` : (running ? 'Copying files' : 'Copied files')
    if (verb === 'mv') return files.at(-1) ? `${running ? 'Moving to' : 'Moved to'} ${fileName(files.at(-1)!)}` : (running ? 'Moving files' : 'Moved files')
    return files[0] ? `${running ? 'Removing' : 'Removed'} ${fileName(files[0])}` : (running ? 'Removing files' : 'Removed files')
  }
  const actionVerb = running ? 'Running' : 'Ran'
  return verb ? `${actionVerb} ${verb}` : `${actionVerb} command`
}

export function commandKind(command: string): CommandKind {
  const verb = fileName(tokenize(firstStage(unwrapShell(command)))[0] ?? '').toLowerCase()
  if (verb === 'sed' || verb === 'cat' || verb === 'bat' || verb === 'head' || verb === 'tail' || verb === 'nl' || verb === 'less' || verb === 'more') return 'read'
  if (verb === 'rg' || verb === 'grep' || verb === 'ag' || verb === 'ack') {
    const args = tokenize(firstStage(unwrapShell(command))).slice(1)
    return listingSearch(args) ? 'list' : 'search'
  }
  if (verb === 'ls' || verb === 'tree' || verb === 'find' || verb === 'fd') return 'list'
  if (verb === 'git') return 'git'
  if ((verb === 'npm' || verb === 'pnpm' || verb === 'yarn' || verb === 'bun') && (tokenize(firstStage(unwrapShell(command)))[1] === 'test')) return 'test'
  return 'run'
}

type Phrased = {
  running: string
  completed: string
  multiRunning?: (count: number) => string
  multiCompleted?: (count: number) => string
}

const TOOL_PHRASES: Record<string, Phrased> = {
  'web search': {
    running: 'Searching the web',
    completed: 'Searched the web',
    multiRunning: (count) => `Searching the web ${count} times`,
    multiCompleted: (count) => `Searched the web ${count} times`
  },
  query: {
    running: 'Searching the web',
    completed: 'Searched the web',
    multiRunning: (count) => `Searching the web ${count} times`,
    multiCompleted: (count) => `Searched the web ${count} times`
  },
  'read page': { running: 'Reading page', completed: 'Read page' },
  page: { running: 'Reading page', completed: 'Read page' },
  'open page': { running: 'Opening page', completed: 'Opened page' },
  'wait for page': { running: 'Waiting for page', completed: 'Waited for page' },
  'analyze page': { running: 'Analyzing page', completed: 'Analyzed page' },
  'analyze app': { running: 'Analyzing app', completed: 'Analyzed app' },
  'wait for app': { running: 'Waiting for app', completed: 'Waited for app' },
  'scroll app': { running: 'Scrolling app', completed: 'Scrolled app' },
  'press app key': { running: 'Pressing app key', completed: 'Pressed app key' },
  'use app': { running: 'Using app', completed: 'Used app' },
  'analyze workspace': { running: 'Analyzing workspace', completed: 'Analyzed workspace' },
  inspect: { running: 'Analyzing workspace', completed: 'Inspected' },
  capture: { running: 'Capturing screenshot', completed: 'Captured' },
  'viewed image': { running: 'Viewing image', completed: 'Viewed image' },
  'fetch page': { running: 'Fetching page', completed: 'Fetched page' },
  'click element': { running: 'Clicking element', completed: 'Clicked element' },
  'click app element': { running: 'Clicking app element', completed: 'Clicked app element' },
  'type text': { running: 'Typing text', completed: 'Typed text' },
  'type in app': { running: 'Typing in app', completed: 'Typed in app' },
  'scroll page': { running: 'Scrolling page', completed: 'Scrolled page' },
  'press key': { running: 'Pressing key', completed: 'Pressed key' },
  'tool call': { running: 'Using a tool', completed: 'Used a tool' }
}

export function toolPhrase(label: string, count = 1, running = false): string {
  const key = label.trim().toLowerCase()
  const phrased = TOOL_PHRASES[key]
  if (phrased) {
    if (count > 1) {
      if (running && phrased.multiRunning) return phrased.multiRunning(count)
      if (!running && phrased.multiCompleted) return phrased.multiCompleted(count)
      const base = running ? phrased.running : phrased.completed
      return `${base} ${count}`
    }
    return running ? phrased.running : phrased.completed
  }
  const base = sentenceCase(label.trim() || 'Used a tool')
  if (count <= 1) return base
  return `${base} ${count}`
}

export function unwrapShell(command: string): string {
  const match = command.match(/^(?:\/usr)?(?:\/bin\/)?(?:ba)?sh\s+-lc\s+([\s\S]+)$/i)
  if (!match) return command
  return unquote(match[1]!.trim())
}

function readPhrase(args: string[], verb: string, running = false): string {
  const files = readFiles(args, verb)
  const action = running ? 'Reading' : 'Read'
  if (files.length === 1) return `${action} ${fileName(files[0]!)}`
  if (files.length > 1) return `${action} ${files.length} files`
  return `${action} file`
}

export function readFiles(args: string[], verb: string): string[] {
  const files = positionals(args, verb)
  if (verb === 'sed') return files.filter((token) => !isSedScript(token))
  return files
}

function isSedScript(token: string): boolean {
  return /^(?:\d+[,\d]*[pP]?|\$|[spy][#/;]).*/.test(token)
}

function searchPhrase(args: string[], running = false): string {
  if (listingSearch(args)) return listPhrase(args, 'rg', running)
  const pattern = searchPattern(args)
  const action = running ? 'Searching' : 'Searched'
  return pattern ? `${action} for ${truncate(pattern, 36)}` : `${action} files`
}

function listPhrase(args: string[], verb: string, running = false): string {
  const files = positionals(args, verb)
  const action = running ? 'Listing' : 'Listed'
  if (verb === 'rg' || verb === 'fd' || verb === 'find') {
    return files[0] ? `${action} files in ${fileName(files[0])}` : `${action} files`
  }
  return files[0] ? `${action} ${fileName(files[0])}` : `${action} files`
}

function gitPhrase(args: string[], running = false): string {
  const sub = args.find((arg) => !arg.startsWith('-'))
  if (sub === 'status') return running ? 'Checking git status' : 'Checked git status'
  if (sub === 'diff') return running ? 'Inspecting git diff' : 'Inspected git diff'
  if (sub === 'log' || sub === 'show') return running ? 'Reading git history' : 'Read git history'
  if (sub === 'add') return running ? 'Staging files' : 'Staged files'
  if (sub === 'commit') return running ? 'Creating a commit' : 'Created a commit'
  return sub ? `${running ? 'Running' : 'Ran'} git ${sub}` : `${running ? 'Running' : 'Ran'} git`
}

function packagePhrase(verb: string, args: string[], running = false): string {
  const script = args.find((arg) => !arg.startsWith('-'))
  if (script === 'test') return running ? 'Running tests' : 'Ran tests'
  if (script === 'install' || script === 'i' || script === 'ci') return running ? 'Installing packages' : 'Installed packages'
  if (script === 'run') {
    const name = args.filter((arg) => !arg.startsWith('-'))[1]
    return name ? `${running ? 'Running' : 'Ran'} ${name}` : `${running ? 'Running' : 'Ran'} ${verb}`
  }
  return script ? `${running ? 'Running' : 'Ran'} ${script}` : `${running ? 'Running' : 'Ran'} ${verb}`
}

function listingSearch(args: string[]): boolean {
  return args.includes('--files') || args.includes('-l') || args.includes('--files-without-match')
}

function searchPattern(args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === '-e' || arg === '--regexp') return args[index + 1] ?? null
    if (arg.startsWith('-')) {
      if (FLAGS_WITH_VALUE.has(arg.split('=')[0]!) && !arg.includes('=')) index += 1
      continue
    }
    return arg
  }
  return null
}

function positionals(args: string[], verb?: string): string[] {
  const files: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg.startsWith('-')) {
      if ((verb === 'head' || verb === 'tail') && (arg === '-n' || arg === '-c')) {
        index += 1
        continue
      }
      if (arg === '-e' || arg === '--regexp') {
        index += 1
        continue
      }
      if (FLAGS_WITH_VALUE.has(arg.split('=')[0]!) && !arg.includes('=')) index += 1
      continue
    }
    files.push(arg)
  }
  return files
}

export function firstStage(command: string): string {
  const stages = splitPipeline(command).map((stage) => stage.trim()).filter(Boolean)
  const interesting = stages.filter((stage) => !/^pwd(?:\s|$)/.test(stage))
  return (interesting.at(-1) ?? stages.at(-1) ?? command).trim()
}

function splitPipeline(command: string): string[] {
  const stages: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!
    if (quote) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }
    if (char === ';' || char === '\n') {
      stages.push(current)
      current = ''
      continue
    }
    if (char === '|') {
      stages.push(current)
      current = ''
      if (command[index + 1] === '|') index += 1
      continue
    }
    if (char === '&' && command[index + 1] === '&') {
      stages.push(current)
      current = ''
      index += 1
      continue
    }
    current += char
  }
  if (current.trim()) stages.push(current)
  return stages.length ? stages : [command]
}

export function tokenize(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  const push = (): void => {
    if (current) tokens.push(unquote(current))
    current = ''
  }
  for (const char of command.trim()) {
    if (quote) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }
    if (/\s/.test(char)) {
      push()
      continue
    }
    current += char
  }
  push()
  return tokens
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))) {
    return value.slice(1, -1)
  }
  return value
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function truncate(value: string, max: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 1).trimEnd()}…`
}

function sentenceCase(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}
