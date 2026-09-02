// The Claude Agent SDK is loaded on first use rather than at startup: it ships a ~1 MB module
// plus a native CLI binary, and the app must not pay for either when the user only uses Codex.
// The package is externalized from the main bundle (electron-vite externalizeDepsPlugin), so
// this dynamic import resolves from node_modules at runtime.

export type ClaudeSdk = typeof import('@anthropic-ai/claude-agent-sdk')

let loading: Promise<ClaudeSdk> | null = null

export function loadClaudeSdk(): Promise<ClaudeSdk> {
  loading ??= import('@anthropic-ai/claude-agent-sdk').catch((error: unknown) => {
    loading = null
    throw new Error(`Claude Agent SDK could not be loaded: ${error instanceof Error ? error.message : String(error)}`)
  })
  return loading
}
