/** Durable artifacts are untrusted collected data, never model instructions. */
export type ArtifactScope = { chatId: string; workspace: string }

export type ArtifactDescriptor = {
  id: string
  sha256: string
  byteLength: number
  mediaType: string
  label: string
  createdAt: string
}

export type ArtifactReservation =
  | { state: 'reserved' }
  | { state: 'complete'; artifact: ArtifactDescriptor }

export type ArtifactRead = {
  artifact: ArtifactDescriptor
  encoding: 'base64' | 'json-text'
  offset: number
  nextOffset: number | null
  total: number
  unit: 'bytes' | 'utf16-code-units'
  data: string
}

export type ArtifactLimits = {
  artifactBytes: number
  scopeBytes: number
  totalBytes: number
  operationsPerScope: number
}

export const DEFAULT_ARTIFACT_LIMITS: ArtifactLimits = {
  artifactBytes: 32 * 1024 * 1024,
  scopeBytes: 256 * 1024 * 1024,
  totalBytes: 1024 * 1024 * 1024,
  operationsPerScope: 10_000
}
