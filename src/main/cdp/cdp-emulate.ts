// Viewport emulation has to go through the embedder, not the protocol. Blink applies CDP's
// `Emulation.setDeviceMetricsOverride` screen metrics, but the layout viewport of a tab hosted
// in a WebContentsView follows the native widget, so `innerWidth` never moves and a page that
// branches on width keeps serving its desktop layout. Electron's `enableDeviceEmulation` resizes
// the emulated widget itself; everything else — locale, geolocation, media, network, CPU — is
// CDP. This module owns the split and the verification that the page really changed.

export type EmulateSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>

export type DeviceEmulationParameters = {
  screenPosition: 'desktop' | 'mobile'
  screenSize: { width: number; height: number }
  viewSize: { width: number; height: number }
  deviceScaleFactor: number
  viewPosition: { x: number; y: number }
  scale: number
}

export type DeviceEmulationTarget = {
  enableDeviceEmulation(parameters: DeviceEmulationParameters): void
  disableDeviceEmulation(): void
}

export type DevicePreset = {
  width: number
  height: number
  deviceScaleFactor: number
  mobile: boolean
  userAgent?: string
}

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

export const DEVICE_PRESETS: Record<string, DevicePreset> = {
  'iphone-15': { width: 393, height: 852, deviceScaleFactor: 3, mobile: true, userAgent: IOS_UA },
  'iphone-se': { width: 375, height: 667, deviceScaleFactor: 2, mobile: true, userAgent: IOS_UA },
  'pixel-8': { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, userAgent: ANDROID_UA },
  'ipad-pro': { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: true, userAgent: IPAD_UA },
  'laptop': { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
  'desktop-1080': { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }
}

export const NETWORK_PROFILES: Record<string, { offline: boolean; latency: number; download: number; upload: number }> = {
  offline: { offline: true, latency: 0, download: 0, upload: 0 },
  'slow-3g': { offline: false, latency: 400, download: 50_000, upload: 50_000 },
  'fast-3g': { offline: false, latency: 150, download: 180_000, upload: 84_375 },
  '4g': { offline: false, latency: 20, download: 4_000_000, upload: 3_000_000 },
  wifi: { offline: false, latency: 2, download: 30_000_000, upload: 15_000_000 }
}

export type EmulateRequest = {
  device?: string
  width?: number
  height?: number
  deviceScaleFactor?: number
  mobile?: boolean
  userAgent?: string
  colorScheme?: 'light' | 'dark'
  reducedMotion?: boolean
  timezone?: string
  locale?: string
  latitude?: number
  longitude?: number
  network?: string
  cpuThrottle?: number
}

export function resolvePreset(request: EmulateRequest): DevicePreset | null {
  if (request.device) {
    const preset = DEVICE_PRESETS[request.device]
    if (!preset) throw new Error(`device must be one of ${Object.keys(DEVICE_PRESETS).join(', ')}`)
    return { ...preset, ...overrides(request) }
  }
  if (request.width === undefined && request.height === undefined) return null
  if (request.width === undefined || request.height === undefined) {
    throw new Error('width and height must be given together when no device preset is named')
  }
  return {
    width: request.width,
    height: request.height,
    deviceScaleFactor: request.deviceScaleFactor ?? 1,
    mobile: request.mobile ?? false,
    userAgent: request.userAgent
  }
}

function overrides(request: EmulateRequest): Partial<DevicePreset> {
  const applied: Partial<DevicePreset> = {}
  if (request.width !== undefined) applied.width = request.width
  if (request.height !== undefined) applied.height = request.height
  if (request.deviceScaleFactor !== undefined) applied.deviceScaleFactor = request.deviceScaleFactor
  if (request.mobile !== undefined) applied.mobile = request.mobile
  if (request.userAgent !== undefined) applied.userAgent = request.userAgent
  return applied
}

export function emulationParameters(preset: DevicePreset): DeviceEmulationParameters {
  return {
    screenPosition: preset.mobile ? 'mobile' : 'desktop',
    screenSize: { width: preset.width, height: preset.height },
    viewSize: { width: preset.width, height: preset.height },
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: preset.deviceScaleFactor,
    scale: 1
  }
}

/** What the page reports about itself, so a caller never has to trust that an override landed. */
export const VERIFY_EXPRESSION = `({
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
  screenWidth: screen.width,
  screenHeight: screen.height,
  devicePixelRatio: window.devicePixelRatio,
  maxTouchPoints: navigator.maxTouchPoints,
  userAgent: navigator.userAgent,
  language: navigator.language,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  online: navigator.onLine
})`

export type EmulateOutcome = { applied: string[]; page: Record<string, unknown> }

export async function applyEmulation(
  target: DeviceEmulationTarget,
  send: EmulateSend,
  request: EmulateRequest
): Promise<EmulateOutcome> {
  const applied: string[] = []
  const preset = resolvePreset(request)
  if (preset) {
    target.enableDeviceEmulation(emulationParameters(preset))
    await send('Emulation.setDeviceMetricsOverride', {
      width: preset.width,
      height: preset.height,
      deviceScaleFactor: preset.deviceScaleFactor,
      mobile: preset.mobile
    })
    await send('Emulation.setTouchEmulationEnabled', {
      enabled: preset.mobile,
      maxTouchPoints: preset.mobile ? 5 : 1
    })
    applied.push(`viewport ${preset.width}x${preset.height}@${preset.deviceScaleFactor}x${preset.mobile ? ' mobile' : ''}`)
    if (preset.userAgent) {
      await send('Emulation.setUserAgentOverride', { userAgent: preset.userAgent })
      applied.push('userAgent')
    }
  }
  if (request.userAgent && !preset?.userAgent) {
    await send('Emulation.setUserAgentOverride', { userAgent: request.userAgent })
    applied.push('userAgent')
  }
  if (request.colorScheme || request.reducedMotion !== undefined) {
    const features: { name: string; value: string }[] = []
    if (request.colorScheme) features.push({ name: 'prefers-color-scheme', value: request.colorScheme })
    if (request.reducedMotion !== undefined) {
      features.push({ name: 'prefers-reduced-motion', value: request.reducedMotion ? 'reduce' : 'no-preference' })
    }
    await send('Emulation.setEmulatedMedia', { media: 'screen', features })
    applied.push(features.map((feature) => feature.name).join(', '))
  }
  if (request.timezone) {
    await send('Emulation.setTimezoneOverride', { timezoneId: request.timezone })
    applied.push(`timezone ${request.timezone}`)
  }
  if (request.locale) {
    await send('Emulation.setLocaleOverride', { locale: request.locale })
    applied.push(`locale ${request.locale}`)
  }
  if (request.latitude !== undefined && request.longitude !== undefined) {
    await send('Emulation.setGeolocationOverride', {
      latitude: request.latitude, longitude: request.longitude, accuracy: 10
    })
    applied.push(`geolocation ${request.latitude},${request.longitude}`)
  }
  if (request.network) {
    const profile = NETWORK_PROFILES[request.network]
    if (!profile) throw new Error(`network must be one of ${Object.keys(NETWORK_PROFILES).join(', ')}`)
    await send('Network.enable')
    await send('Network.emulateNetworkConditions', {
      offline: profile.offline,
      latency: profile.latency,
      downloadThroughput: profile.download,
      uploadThroughput: profile.upload
    })
    applied.push(`network ${request.network}`)
  }
  if (request.cpuThrottle !== undefined) {
    await send('Emulation.setCPUThrottlingRate', { rate: request.cpuThrottle })
    applied.push(`cpu ${request.cpuThrottle}x slowdown`)
  }
  return { applied, page: await verify(send) }
}

export async function resetEmulation(target: DeviceEmulationTarget, send: EmulateSend): Promise<EmulateOutcome> {
  target.disableDeviceEmulation()
  const cleared: string[] = []
  const clear = async (method: string, params?: Record<string, unknown>) => {
    try {
      await send(method, params)
      cleared.push(method)
    } catch {
      // A domain that was never enabled has nothing to clear.
    }
  }
  await clear('Emulation.clearDeviceMetricsOverride')
  await clear('Emulation.setTouchEmulationEnabled', { enabled: false })
  await clear('Emulation.setUserAgentOverride', { userAgent: '' })
  await clear('Emulation.setEmulatedMedia', { media: '', features: [] })
  await clear('Emulation.setTimezoneOverride', { timezoneId: '' })
  await clear('Emulation.setLocaleOverride', {})
  await clear('Emulation.clearGeolocationOverride')
  await clear('Emulation.setCPUThrottlingRate', { rate: 1 })
  await clear('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1
  })
  return { applied: cleared, page: await verify(send) }
}

async function verify(send: EmulateSend): Promise<Record<string, unknown>> {
  const evaluated = await send('Runtime.evaluate', { expression: VERIFY_EXPRESSION, returnByValue: true })
  const value = (evaluated as { result?: { value?: unknown } } | null)?.result?.value
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}
