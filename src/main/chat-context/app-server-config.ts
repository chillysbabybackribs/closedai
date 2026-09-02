import type { AppSettings } from '../../shared/types.js'

// Codex config overrides passed on the app-server command line. They apply to every thread the
// process serves and are read once per launch, so a changed setting takes effect on the next
// (re)start of the app-server. Keys are validated by Codex itself (`--strict-config` rejects
// unknown fields), so only keys verified against the installed CLI belong here.

/** Codex compacts inside a turn once the context passes this many tokens (codex-cli 0.152.1). */
const AUTO_COMPACT_TOKEN_LIMIT = 'model_auto_compact_token_limit'

/** `-c key=value` pairs for `codex app-server`, derived from the app settings. */
export function appServerConfigArgs(settings: Pick<AppSettings, 'chatMidTurnCompactTokens'>): string[] {
  const args: string[] = []
  if (settings.chatMidTurnCompactTokens > 0) {
    args.push('-c', `${AUTO_COMPACT_TOKEN_LIMIT}=${Math.round(settings.chatMidTurnCompactTokens)}`)
  }
  return args
}
