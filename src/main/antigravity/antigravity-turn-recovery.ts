import type { ChatConnection } from '../../shared/chat.js'
import { messageOf } from '../chat-normalizers.js'
import { isAntigravityAuthFailure, runAntigravityCommand } from './antigravity-cli.js'
import { ensureAntigravityProfile, recordUndeclarableTools, undeclarableToolsFrom, type AntigravityProfile } from './antigravity-profile.js'
import type { AntigravitySession } from './antigravity-session.js'

const SIGN_IN_MESSAGE = 'Sign in to Antigravity: run `agy` in a terminal, complete the Google login, then choose an Antigravity model again.'

export type AntigravityTurnRecoveryHost = {
  cwd: string
  stateDir: string
  session(): AntigravitySession | null
  activeTurnId(): string | null
  authRetrying(): boolean
  setAuthRetrying(value: boolean): void
  lastTurnContent(): string | null
  setProfile(profile: AntigravityProfile | null): void
  setConnection(connection: ChatConnection): void
  addNotice(text: string, tone: 'info' | 'error', turnId: string | null): void
  persistTurn(): void
}

export function retryAntigravityOnAuthFailure(host: AntigravityTurnRecoveryHost, turnId: string, error: string): boolean {
  if (!isAntigravityAuthFailure(error) || host.authRetrying()) return false
  const session = host.session()
  if (!session || !session.conversationId) return false
  host.setAuthRetrying(true)
  void (async () => {
    try {
      await session.retire()
      const check = await runAntigravityCommand(['models'])
      if (!check.ok) {
        host.setConnection({ state: 'signed-out', message: SIGN_IN_MESSAGE })
        host.addNotice('Antigravity session expired. Please sign in via terminal `agy` and retry.', 'error', turnId)
        host.persistTurn()
        return
      }
      host.addNotice('Antigravity credentials refreshed; continuing turn…', 'info', turnId)
      if (host.session() !== session || host.activeTurnId()) throw new Error('Antigravity conversation changed while retrying after auth refresh')
      session.send('The stream was interrupted due to a credential refresh. Please continue the task you were working on.')
    } catch (retryError) {
      host.addNotice(messageOf(retryError), 'error', turnId)
      host.persistTurn()
    }
  })()
  return true
}

export function retryAntigravityWithoutUndeclaredTools(host: AntigravityTurnRecoveryHost, turnId: string, error: string): boolean {
  const rejected = undeclarableToolsFrom(error)
  const content = host.lastTurnContent()
  const session = host.session()
  if (rejected.length === 0 || !content || !session) return false
  void (async () => {
    try {
      const added = await recordUndeclarableTools(host.stateDir, rejected)
      if (added.length === 0) throw new Error(error)
      host.addNotice(`Antigravity no longer declares ${added.join(', ')}; retrying without`, 'info', turnId)
      await session.retire()
      host.setProfile(await ensureAntigravityProfile(host.stateDir, { cwd: host.cwd }))
      if (host.session() !== session || host.activeTurnId()) throw new Error('Antigravity conversation changed while retrying the turn')
      session.send(content)
    } catch (retryError) {
      host.addNotice(messageOf(retryError), 'error', turnId)
      host.persistTurn()
    }
  })()
  return true
}
