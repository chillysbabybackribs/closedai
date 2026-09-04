import type { JSX } from 'react'
import { Check } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { CREDENTIAL_SERVICES, type CredentialServiceId, type CredentialServiceSpec } from '../../shared/credentials.js'
import { CREDENTIAL_SERVICE_LOGOS, RemoteServiceLogo } from './credential-service-logos.js'

export type CredentialServicePickerProps = {
  selectedId: CredentialServiceId
  /** Host detected from the URL field, used as the Custom card's mark. */
  detectedDomain: string
  /** Name to show on the Custom card once a URL identified an unlisted service. */
  detectedName: string
  onSelect: (id: CredentialServiceId) => void
}

/**
 * The service grid of the create form. Picking a card swaps the field set below it,
 * and a URL the catalog does not claim lands on Custom wearing that site's own icon.
 */
export function CredentialServicePicker({
  selectedId,
  detectedDomain,
  detectedName,
  onSelect
}: CredentialServicePickerProps): JSX.Element {
  return (
    <div className="credential-service-grid" role="radiogroup" aria-label="Service">
      {CREDENTIAL_SERVICES.map((service) => (
        <ServiceCard
          key={service.id}
          service={service}
          selected={service.id === selectedId}
          detectedDomain={detectedDomain}
          detectedName={detectedName}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

type ServiceCardProps = {
  service: CredentialServiceSpec
  selected: boolean
  detectedDomain: string
  detectedName: string
  onSelect: (id: CredentialServiceId) => void
}

function ServiceCard({ service, selected, detectedDomain, detectedName, onSelect }: ServiceCardProps): JSX.Element {
  const Logo = CREDENTIAL_SERVICE_LOGOS[service.id]
  const wearsDetectedSite = service.id === 'custom' && detectedDomain.length > 0

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-ui="credentials.service"
      data-ui-key={service.id}
      className={cn('credential-service-card', selected && 'credential-service-card-selected')}
      onClick={() => onSelect(service.id)}
    >
      <span className="credential-service-mark">
        {wearsDetectedSite ? <RemoteServiceLogo domain={detectedDomain} name={detectedName} /> : <Logo />}
      </span>
      <span className="credential-service-name">
        {wearsDetectedSite ? detectedName || service.name : service.name}
      </span>
      <span className="credential-service-description">
        {wearsDetectedSite ? detectedDomain : service.description}
      </span>
      {service.difficulty === 'two-step' ? <span className="credential-service-note">2 steps</span> : null}
      <span className="credential-service-check" aria-hidden="true">
        {selected ? <Check className="size-3" /> : null}
      </span>
    </button>
  )
}
