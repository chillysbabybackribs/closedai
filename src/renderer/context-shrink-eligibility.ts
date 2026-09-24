import type { ChatProvider } from '../shared/chat.js'

/** Whether the composer and Agent menu should offer manual provider context shrink. */
export function providerSupportsContextShrink(
  provider: ChatProvider,
  seamlessRotation: boolean | undefined
): boolean {
  if (provider === 'antigravity') return true
  if (seamlessRotation === true) {
    return provider === 'claude' || provider === 'codex' || provider === 'cursor'
  }
  return provider === 'codex'
}
