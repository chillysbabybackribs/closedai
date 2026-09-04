import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CREDENTIAL_SERVICES,
  credentialDomain,
  matchCredentialService,
  serviceNameFromDomain
} from './credentials.ts'

test('a service console URL selects the service that owns it', () => {
  assert.deepEqual(matchCredentialService('https://dashboard.stripe.com/apikeys'), {
    serviceId: 'stripe',
    domain: 'dashboard.stripe.com',
    label: 'Stripe',
    recognised: true
  })
})

test('a project subdomain matches the registrable domain its service claims', () => {
  const match = matchCredentialService('https://abcdefghijkl.supabase.co')
  assert.equal(match?.serviceId, 'supabase')
  assert.equal(match?.recognised, true)
})

test('a bare domain works without a scheme', () => {
  assert.equal(matchCredentialService('resend.com')?.serviceId, 'resend')
})

test('an unclaimed domain becomes a Custom entry named after itself', () => {
  assert.deepEqual(matchCredentialService('https://www.notion.so/my-workspace'), {
    serviceId: 'custom',
    domain: 'notion.so',
    label: 'Notion',
    recognised: false
  })
})

test('a plain service name matches the catalog, and an unknown one does not', () => {
  assert.equal(matchCredentialService('anthropic')?.serviceId, 'anthropic')
  assert.equal(matchCredentialService('some internal tool'), null)
  assert.equal(matchCredentialService('   '), null)
})

test('only host-shaped input yields a domain', () => {
  assert.equal(credentialDomain('https://api.linear.app/graphql'), 'api.linear.app')
  assert.equal(credentialDomain('Linear'), '')
  assert.equal(credentialDomain('some internal tool'), '')
})

test('generic consoles do not become the service name', () => {
  assert.equal(serviceNameFromDomain('api.linear.app'), 'Linear')
  assert.equal(serviceNameFromDomain('planetscale.com'), 'Planetscale')
})

test('every claimed domain is registrable form, so subdomains still match', () => {
  for (const service of CREDENTIAL_SERVICES) {
    for (const domain of service.domains ?? []) {
      assert.equal(domain, domain.toLowerCase(), `${service.id} claims a mixed-case domain`)
      assert.equal(domain.split('.').length, 2, `${service.id} claims a subdomain: ${domain}`)
    }
  }
})
