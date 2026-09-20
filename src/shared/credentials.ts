/**
 * Credential vault contracts, shared by the encrypted main-process store and the
 * renderer wizard. The service catalog lives here so both sides validate the same
 * required fields: the renderer to gate the wizard's Next button, the store to
 * reject a draft that reached it another way.
 */

export type CredentialFieldKind = 'text' | 'secret' | 'url' | 'username'

export type CredentialFieldSpec = {
  id: string
  label: string
  kind: CredentialFieldKind
  placeholder?: string
  required?: boolean
  help?: string
}

export type CredentialServiceId =
  | 'api-key'
  | 'login'
  | 'stripe'
  | 'supabase'
  | 'openai'
  | 'discord'
  | 'anthropic'
  | 'resend'
  | 'neon'
  | 'planetscale'
  | 'redis'
  | 'custom'

/** How many steps the provider's own console needs to produce the credential. */
export type CredentialImportDifficulty = 'easy' | 'two-step'

export type CredentialServiceSpec = {
  id: CredentialServiceId
  name: string
  description: string
  difficulty: CredentialImportDifficulty
  /** Where the user goes to mint the credential; opened in the app browser. */
  docsUrl?: string
  /** Hosts this service answers for, so a pasted URL selects it. Registrable form. */
  domains?: readonly string[]
  fields: CredentialFieldSpec[]
}

export const CREDENTIAL_SERVICES: readonly CredentialServiceSpec[] = [
  {
    id: 'api-key',
    name: 'API Key',
    description: 'A token, secret, or access key for a service.',
    difficulty: 'easy',
    fields: [
      { id: 'url', label: 'Website or service URL', kind: 'url', placeholder: 'https://api.example.com' },
      { id: 'apiKey', label: 'API key', kind: 'secret', required: true }
    ]
  },
  {
    id: 'login',
    name: 'Login',
    description: 'A username and password for a website or service.',
    difficulty: 'easy',
    fields: [
      { id: 'url', label: 'Website or service URL', kind: 'url', placeholder: 'https://example.com' },
      { id: 'username', label: 'Username or email', kind: 'username', required: true },
      { id: 'password', label: 'Password', kind: 'secret', required: true }
    ]
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payment processing platform for online transactions.',
    difficulty: 'easy',
    docsUrl: 'https://dashboard.stripe.com/apikeys',
    domains: ['stripe.com'],
    fields: [
      { id: 'secretKey', label: 'Secret key', kind: 'secret', required: true, placeholder: 'sk_live_…' },
      { id: 'publishableKey', label: 'Publishable key', kind: 'text', placeholder: 'pk_live_…' },
      { id: 'webhookSecret', label: 'Webhook signing secret', kind: 'secret', placeholder: 'whsec_…' }
    ]
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Open-source Firebase alternative with database and authentication.',
    difficulty: 'easy',
    docsUrl: 'https://supabase.com/dashboard/project/_/settings/api',
    domains: ['supabase.com', 'supabase.co'],
    fields: [
      { id: 'projectUrl', label: 'Project URL', kind: 'url', required: true, placeholder: 'https://xyz.supabase.co' },
      { id: 'anonKey', label: 'Anon public key', kind: 'secret', required: true, placeholder: 'eyJhbGciOi…' },
      { id: 'serviceRoleKey', label: 'Service role key', kind: 'secret', help: 'Full database access. Store it only if an agent needs it.' }
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'AI models and APIs for building intelligent applications.',
    difficulty: 'easy',
    docsUrl: 'https://platform.openai.com/api-keys',
    domains: ['openai.com', 'chatgpt.com'],
    fields: [
      { id: 'apiKey', label: 'API key', kind: 'secret', required: true, placeholder: 'sk-…' },
      { id: 'organizationId', label: 'Organization ID', kind: 'text', placeholder: 'org-…' }
    ]
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Communication platform for communities with chat and voice.',
    difficulty: 'easy',
    docsUrl: 'https://discord.com/developers/applications',
    domains: ['discord.com', 'discord.gg'],
    fields: [
      { id: 'botToken', label: 'Bot token', kind: 'secret', required: true },
      { id: 'applicationId', label: 'Application ID', kind: 'text' }
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'AI safety company building reliable and interpretable AI systems.',
    difficulty: 'two-step',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    domains: ['anthropic.com', 'claude.com', 'claude.ai'],
    fields: [
      { id: 'apiKey', label: 'API key', kind: 'secret', required: true, placeholder: 'sk-ant-…' },
      { id: 'workspaceId', label: 'Workspace ID', kind: 'text', help: 'Only needed when the key is scoped to a workspace.' }
    ]
  },
  {
    id: 'resend',
    name: 'Resend',
    description: 'Modern email API built for developers with great deliverability.',
    difficulty: 'easy',
    docsUrl: 'https://resend.com/api-keys',
    domains: ['resend.com'],
    fields: [
      { id: 'apiKey', label: 'API key', kind: 'secret', required: true, placeholder: 're_…' },
      { id: 'fromAddress', label: 'Default from address', kind: 'text', placeholder: 'noreply@example.com' }
    ]
  },
  {
    id: 'neon',
    name: 'Neon',
    description: 'Serverless Postgres database with branching and auto-scaling.',
    difficulty: 'two-step',
    docsUrl: 'https://console.neon.tech/app/settings/api-keys',
    domains: ['neon.tech', 'neon.com'],
    fields: [
      { id: 'connectionString', label: 'Connection string', kind: 'secret', required: true, placeholder: 'postgresql://user:pass@host/db' },
      { id: 'apiKey', label: 'API key', kind: 'secret', help: 'Needed for branch and project management calls.' }
    ]
  },
  {
    id: 'planetscale',
    name: 'PlanetScale',
    description: 'MySQL-compatible serverless database with branching workflows.',
    difficulty: 'two-step',
    docsUrl: 'https://app.planetscale.com',
    domains: ['planetscale.com', 'psdb.cloud'],
    fields: [
      { id: 'host', label: 'Host', kind: 'text', required: true, placeholder: 'aws.connect.psdb.cloud' },
      { id: 'username', label: 'Username', kind: 'username', required: true },
      { id: 'password', label: 'Password', kind: 'secret', required: true }
    ]
  },
  {
    id: 'redis',
    name: 'Redis',
    description: 'In-memory data store for caching, messaging, and real-time apps.',
    difficulty: 'easy',
    domains: ['redis.io', 'redis.com'],
    fields: [
      { id: 'connectionUrl', label: 'Connection URL', kind: 'secret', required: true, placeholder: 'rediss://default:pass@host:6379' },
      { id: 'username', label: 'Username', kind: 'username', placeholder: 'default' }
    ]
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Any other API key or account login, stored under a name you choose.',
    difficulty: 'easy',
    fields: [
      { id: 'url', label: 'Service URL', kind: 'url', placeholder: 'https://api.example.com' },
      { id: 'username', label: 'Username or email', kind: 'username' },
      { id: 'secret', label: 'API key or password', kind: 'secret', required: true }
    ]
  }
]

export function credentialService(id: string): CredentialServiceSpec | undefined {
  return CREDENTIAL_SERVICES.find((service) => service.id === id)
}

/** What a typed URL or service name resolved to. */
export type CredentialServiceMatch = {
  serviceId: CredentialServiceId
  /** Host the input resolved to, empty when the input was a plain name. */
  domain: string
  /** Suggested entry label: the catalog name, or one derived from the domain. */
  label: string
  /** True when a catalog service claims the domain, false when it fell back to Custom. */
  recognised: boolean
}

/** Subdomains that name the console rather than the company. */
const GENERIC_SUBDOMAINS = new Set([
  'www', 'api', 'app', 'my', 'dashboard', 'console', 'developer', 'developers', 'docs', 'dev', 'portal', 'platform'
])

/** Host of a URL, bare domain, or empty string when the input is not one. */
export function credentialDomain(input: string): string {
  const text = input.trim()
  if (!text) return ''

  let host: string
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    host = new URL(hasScheme ? text : `https://${text}`).hostname.toLowerCase()
  } catch {
    return ''
  }

  // No dot means it was a plain name ("Stripe"), not a host.
  return host.includes('.') ? host.replace(/^www\./, '') : ''
}

/** "dashboard.stripe.com" and "stripe.com" both read as "Stripe". */
export function serviceNameFromDomain(domain: string): string {
  const parts = domain.split('.')
  const label = parts.length > 2 && GENERIC_SUBDOMAINS.has(parts[0]!) ? parts[1]! : parts[0]!
  return label
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Resolve what the user meant by a pasted URL or a typed service name. An unclaimed
 * domain is not a failure: it becomes a Custom entry that still carries its own name.
 */
export function matchCredentialService(input: string): CredentialServiceMatch | null {
  const text = input.trim()
  if (!text) return null

  const domain = credentialDomain(text)
  if (domain) {
    const parts = domain.split('.')
    const registrable = parts.length > 2 ? parts.slice(-2).join('.') : domain
    const owner = CREDENTIAL_SERVICES.find((service) =>
      service.domains?.some((claim) => claim === domain || claim === registrable)
    )
    if (owner) return { serviceId: owner.id, domain, label: owner.name, recognised: true }
    return { serviceId: 'custom', domain, label: serviceNameFromDomain(domain), recognised: false }
  }

  const named = CREDENTIAL_SERVICES.find((service) => service.name.toLowerCase() === text.toLowerCase())
  if (named) return { serviceId: named.id, domain: '', label: named.name, recognised: true }
  return null
}

/** A field as the renderer sees it: secret values are masked until explicitly revealed. */
export type CredentialFieldSummary = {
  id: string
  label: string
  kind: CredentialFieldKind
  /** Masked for secrets, the stored value for everything else. Empty when unset. */
  preview: string
  hasValue: boolean
}

export type CredentialSummary = {
  id: string
  serviceId: CredentialServiceId
  serviceName: string
  label: string
  createdAt: number
  updatedAt: number
  /** False when the OS keychain was unavailable and secrets fell back to plain storage. */
  encrypted: boolean
  fields: CredentialFieldSummary[]
}

export type CredentialDraft = {
  serviceId: CredentialServiceId
  /** User-facing name; defaults to the service name when blank. */
  label: string
  values: Record<string, string>
}

export type CredentialVaultStatus = {
  /** True when Electron safeStorage can reach an OS keychain to encrypt secrets. */
  encryptionAvailable: boolean
  /** Human-readable backend name, for example "libsecret" or "unavailable". */
  backend: string
  count: number
}

const MASK = '•'.repeat(8)

/** Mask a secret the same way on both sides of the bridge. */
export function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return MASK
  return `${value.slice(0, 3)}${MASK}${value.slice(-4)}`
}

/** Required fields of a draft's service that are still blank. */
export function missingCredentialFields(draft: CredentialDraft): CredentialFieldSpec[] {
  const service = credentialService(draft.serviceId)
  if (!service) return []
  return service.fields.filter((field) => field.required && !draft.values[field.id]?.trim())
}
