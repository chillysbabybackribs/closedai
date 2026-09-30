import { CHAT_PROVIDERS } from '../shared/chat-providers.js'
import type { ProviderOnboardingStatus } from '../shared/provider-onboarding.js'
import { detectProviderAvailability } from './provider-availability.js'
import type { ChatHub } from './chat-hub.js'

export async function probeProviderOnboarding(hub: ChatHub | null): Promise<ProviderOnboardingStatus[]> {
  const availability = await detectProviderAvailability()
  return Promise.all(CHAT_PROVIDERS.map(async (provider) => {
    const entry = availability.find((row) => row.provider === provider)
    const installed = entry?.installed ?? false
    if (!installed) {
      return { provider, installed: false, connection: 'unavailable' as const, accountEmail: null }
    }
    if (!hub) {
      return { provider, installed: true, connection: 'unknown' as const, accountEmail: null }
    }
    const { connection, accountEmail } = await hub.probeProviderConnection(provider)
    return { provider, installed: true, connection: connection.state, accountEmail }
  }))
}
