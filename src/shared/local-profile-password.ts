/** PBKDF2-SHA256 hashes for the local session gate (machine-local deterrent, not cloud auth). */

const ITERATIONS = 210_000
const SALT_BYTES = 16
const KEY_BYTES = 32
const PREFIX = 'pbkdf2-sha256'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

function base64ToBytes(encoded: string): Uint8Array | null {
  try {
    const binary = atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const saltBuffer = new Uint8Array(salt)
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBuffer, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_BYTES * 8
  )
  return new Uint8Array(bits)
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!
  return diff === 0
}

export async function hashLocalProfilePassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const derived = await deriveBits(password, salt, ITERATIONS)
  return `${PREFIX}:${ITERATIONS}:${bytesToBase64(salt)}:${bytesToBase64(derived)}`
}

export async function verifyLocalProfilePassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith(`${PREFIX}:`)) return false
  const parts = stored.split(':')
  if (parts.length !== 4) return false
  const iterations = Number(parts[1])
  if (!Number.isFinite(iterations) || iterations < 1) return false
  const salt = base64ToBytes(parts[2] ?? '')
  const expected = base64ToBytes(parts[3] ?? '')
  if (!salt || !expected) return false
  const derived = await deriveBits(password, salt, iterations)
  return timingSafeEqual(derived, expected)
}
