/** Turn a shell command into a short process-line phrase. Raw argv stays in expanded details. */

export type CommandKind = 'read' | 'search' | 'list' | 'edit' | 'git' | 'test' | 'run'

const FLAGS_WITH_VALUE = new Set([
  '-A', '-B', '-C', '-d', '-e', '-f', '-g', '-m', '-t', '-T', '-j',
  '--glob', '--type', '--type-add', '--type-not', '--regexp', '--file',
  '--max-count', '--max-depth', '--max-filesize', '--max-columns',
  '--ignore-file', '--path-separator'
])

export function commandPhrase(command: string): string {
  const stage = firstStage(unwrapShell(command))
  const argv = tokenize(stage)
  const verb = fileName(argv[0] ?? '').toLowerCase()
  const args = argv.slice(1)
  if (verb === 'sed' || verb === 'cat' || verb === 'bat' || verb === 'head' || verb === 'tail' || verb === 'nl' || verb === 'less' || verb === 'more') {
    return readPhrase(args, verb)
  }
  if (verb === 'rg' || verb === 'grep' || verb === 'ag' || verb === 'ack') return searchPhrase(args)
  if (verb === 'ls' || verb === 'tree' || verb === 'find' || verb === 'fd') return listPhrase(args, verb)
  if (verb === 'git') return gitPhrase(args)
  if (verb === 'npm' || verb === 'pnpm' || verb === 'yarn' || verb === 'bun') return packagePhrase(verb, args)
  if (verb === 'pwd') return 'Checked directory'
  if (verb === 'wc') return 'Counted lines'
  if (verb === 'mkdir' || verb === 'touch' || verb === 'cp' || verb === 'mv' || verb === 'rm') {
    const files = positionals(args)
    if (verb === 'mkdir') return files[0] ? `Created ${fileName(files[0])}` : 'Created directory'
    if (verb === 'touch') return files[0] ? `Created ${fileName(files[0])}` : 'Created file'
    if (verb === 'cp') return files.at(-1) ? `Copied to ${fileName(files.at(-1)!)}` : 'Copied files'
    if (verb === 'mv') return files.at(-1) ? `Moved to ${fileName(files.at(-1)!)}` : 'Moved files'
    return files[0] ? `Removed ${fileName(files[0])}` : 'Removed files'
  }
  return verb ? `Ran ${verb}` : 'Ran command'
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

export function toolPhrase(label: string, count = 1): string {
  const key = label.trim().toLowerCase()
  const named: Record<string, string> = {
    'web search': 'Searched the web',
    'viewed image': 'Viewed image',
    inspect: 'Inspected',
    capture: 'Captured',
    'tool call': 'Used a tool'
  }
  const base = named[key] ?? sentenceCase(label.trim() || 'Used a tool')
  if (count <= 1) return base
  if (key === 'web search') return `Searched the web ${count} times`
  return `${base} ${count}`
}

export function unwrapShell(command: string): string {
  const match = command.match(/^(?:\/usr)?(?:\/bin\/)?(?:ba)?sh\s+-lc\s+([\s\S]+)$/i)
  if (!match) return command
  return unquote(match[1]!.trim())
}

function readPhrase(args: string[], verb: string): string {
  const files = readFiles(args, verb)
  if (files.length === 1) return `Read ${fileName(files[0]!)}`
  if (files.length > 1) return `Read ${files.length} files`
  return 'Read file'
}

function readFiles(args: string[], verb: string): string[] {
  const files = positionals(args)
  if (verb === 'sed') return files.filter((token) => !isSedScript(token))
  return files
}

function isSedScript(token: string): boolean {
  return /^(?:\d+[,\d]*[pP]?|\$|[spy][#/;]).*/.test(token)
}

function searchPhrase(args: string[]): string {
  if (listingSearch(args)) return listPhrase(args, 'rg')
  const pattern = searchPattern(args)
  return pattern ? `Searched for ${truncate(pattern, 36)}` : 'Searched files'
}

function listPhrase(args: string[], verb: string): string {
  const files = positionals(args)
  if (verb === 'rg' || verb === 'fd' || verb === 'find') {
    return files[0] ? `Listed files in ${fileName(files[0])}` : 'Listed files'
  }
  return files[0] ? `Listed ${fileName(files[0])}` : 'Listed files'
}

function gitPhrase(args: string[]): string {
  const sub = args.find((arg) => !arg.startsWith('-'))
  if (sub === 'status') return 'Checked git status'
  if (sub === 'diff') return 'Inspected git diff'
  if (sub === 'log' || sub === 'show') return 'Read git history'
  if (sub === 'add') return 'Staged files'
  if (sub === 'commit') return 'Created a commit'
  return sub ? `Ran git ${sub}` : 'Ran git'
}

function packagePhrase(verb: string, args: string[]): string {
  const script = args.find((arg) => !arg.startsWith('-'))
  if (script === 'test') return 'Ran tests'
  if (script === 'install' || script === 'i' || script === 'ci') return 'Installed packages'
  if (script === 'run') {
    const name = args.filter((arg) => !arg.startsWith('-'))[1]
    return name ? `Ran ${name}` : `Ran ${verb}`
  }
  return script ? `Ran ${script}` : `Ran ${verb}`
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

function positionals(args: string[]): string[] {
  const files: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg.startsWith('-')) {
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

function firstStage(command: string): string {
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
    if (char === '|' && command[index + 1] !== '|') {
      stages.push(current)
      current = ''
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

function tokenize(command: string): string[] {
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
