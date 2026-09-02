import type { JSX } from 'react'

import type { ChatProvider } from '../../shared/chat.js'
import { ClaudeLogo, OpenAILogo, type LogoProps } from './provider-logos.js'

export type ProviderMarkProps = LogoProps & {
  provider: ChatProvider
  /** Label for the mark when it is the only thing naming the provider. Decorative by default. */
  label?: string
}

const PROVIDER_NAMES: Record<ChatProvider, string> = {
  codex: 'OpenAI',
  claude: 'Claude'
}

/**
 * The provider's brand mark, sized like an icon. The raw logos set no default size — unsized they
 * render at their intrinsic ~256px — so every call site goes through here to get one.
 *
 * Note the marks colour differently: OpenAI's fills with `currentColor`, Claude's carries a fixed
 * `#D97757`. Dim this with `opacity-*`, never with a `text-*` utility, or the two drift apart.
 */
export function ProviderMark({ provider, label, className, ...props }: ProviderMarkProps): JSX.Element {
  const Logo = provider === 'claude' ? ClaudeLogo : OpenAILogo
  const named = label !== undefined
  return (
    <Logo
      className={className ?? 'size-3.5'}
      aria-hidden={named ? undefined : 'true'}
      role={named ? 'img' : undefined}
      aria-label={named ? label || PROVIDER_NAMES[provider] : undefined}
      {...props}
    />
  )
}
