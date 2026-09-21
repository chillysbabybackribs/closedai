import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import type { ChatProvider } from '../shared/chat.js'
import { CHAT_PROVIDERS } from '../shared/chat-providers.js'
import type { ProviderAvailability } from '../shared/provider-availability.js'
import { ANTIGRAVITY_BINARY_ENV } from './antigravity/antigravity-cli.js'
import { CURSOR_BINARY_ENV } from './cursor/cursor-cli.js'
import { CODEX_BINARY_ENV, PROVIDER_INSTALL_HINTS, PROVIDER_SIGN_IN_HINTS } from './provider-binary.js'

// Which providers can start on this machine, for the first-run screen. The resolution mirrors
// what each lane does when it spawns: an explicit env override, then the official installer's
// ~/.local/bin (which a desktop-launched Electron often lacks on PATH), then PATH. Claude is the
// bundled Agent SDK and is always present. Nothing here is spawned; a probe must stay cheap
// enough to run on every launch.

export type AvailabilityProbe = {
  env?: NodeJS.ProcessEnv
  home?: string
  exists?: (path: string) => boolean
  platform?: NodeJS.Platform
}

type ExternalBinary = { provider: ChatProvider; name: string; envVar: string; installerPath: boolean }

const EXTERNAL_BINARIES: readonly ExternalBinary[] = [
  { provider: 'codex', name: 'codex', envVar: CODEX_BINARY_ENV, installerPath: false },
  { provider: 'antigravity', name: 'agy', envVar: ANTIGRAVITY_BINARY_ENV, installerPath: true },
  { provider: 'cursor', name: 'cursor-agent', envVar: CURSOR_BINARY_ENV, installerPath: true }
]

/** The first PATH entry holding `name` (with PATHEXT suffixes on Windows), or null. */
export function findOnPath(name: string, probe: Required<AvailabilityProbe>): string | null {
  const suffixes = probe.platform === 'win32' ? (probe.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (probe.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const suffix of suffixes) {
      const candidate = join(dir, `${name}${suffix}`)
      if (probe.exists(candidate)) return candidate
    }
  }
  return null
}

/** Resolve one external binary the way its lane would spawn it; null when nothing is found. */
export function resolveExternalBinary(binary: ExternalBinary, probe: Required<AvailabilityProbe>): string | null {
  const configured = probe.env[binary.envVar]?.trim()
  if (configured) {
    if (isAbsolute(configured) || configured.includes('/') || configured.includes('\\')) {
      return probe.exists(configured) ? configured : null
    }
    return findOnPath(configured, probe)
  }
  if (binary.installerPath) {
    const installed = join(probe.home, '.local', 'bin', binary.name)
    if (probe.exists(installed)) return installed
  }
  return findOnPath(binary.name, probe)
}

export async function detectProviderAvailability(options: AvailabilityProbe = {}): Promise<ProviderAvailability[]> {
  const probe: Required<AvailabilityProbe> = {
    env: options.env ?? process.env,
    home: options.home ?? homedir(),
    exists: options.exists ?? existsSync,
    platform: options.platform ?? process.platform
  }
  return CHAT_PROVIDERS.map((provider) => {
    const binary = EXTERNAL_BINARIES.find((entry) => entry.provider === provider)
    if (!binary) return { provider, installed: true, path: null, hint: PROVIDER_SIGN_IN_HINTS[provider] }
    const path = resolveExternalBinary(binary, probe)
    return {
      provider,
      installed: path !== null,
      path,
      hint: path !== null ? PROVIDER_SIGN_IN_HINTS[provider] : PROVIDER_INSTALL_HINTS[provider]
    }
  })
}
