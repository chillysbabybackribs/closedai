import type { ChatSnapshot } from '../../shared/chat.js'

/** True while a pane has a foreground turn or provider-native background work still running. */
export function paneSurfaceBusy(
  snapshot: Pick<ChatSnapshot, 'activeTurnId'>,
  hasRunningBackground?: () => boolean
): boolean {
  return snapshot.activeTurnId !== null || Boolean(hasRunningBackground?.())
}
