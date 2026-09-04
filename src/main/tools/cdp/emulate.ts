import { defineActionTool, type ToolAction } from '../action-tool.js'
import { DEVICE_PRESETS, NETWORK_PROFILES, type EmulateRequest } from '../../cdp/cdp-emulate.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { booleanArg, stringArg, type JsonObject, type ToolDefinition } from '../tool.js'
import { tabIdField, tabIdFrom } from './fields.js'
import { requireCdp, type CdpHostProvider } from './host.js'

const deviceNames = Object.keys(DEVICE_PRESETS)
const networkNames = Object.keys(NETWORK_PROFILES)

const applyProperties: Record<string, JsonObject> = {
  tab_id: tabIdField,
  device: {
    type: 'string',
    enum: deviceNames,
    description: `Device preset: ${deviceNames.join(', ')}. Sets viewport, scale factor, touch and user agent together; individual fields below override parts of it.`
  },
  width: { type: 'integer', minimum: 200, maximum: 4_000, description: 'Layout viewport width in CSS pixels. Give with height when no preset is named.' },
  height: { type: 'integer', minimum: 200, maximum: 4_000, description: 'Layout viewport height in CSS pixels.' },
  device_scale_factor: { type: 'number', minimum: 0.5, maximum: 5, description: 'devicePixelRatio; default 1.' },
  mobile: { type: 'boolean', description: 'Mobile screen position, touch events and mobile viewport behaviour.' },
  user_agent: { type: 'string', minLength: 1, maxLength: 500, description: 'User-Agent override; a preset supplies its own.' },
  color_scheme: { type: 'string', enum: ['light', 'dark'], description: 'prefers-color-scheme.' },
  reduced_motion: { type: 'boolean', description: 'prefers-reduced-motion.' },
  timezone: { type: 'string', minLength: 1, description: 'IANA timezone, for example Asia/Tokyo. Changes Date and Intl inside the page.' },
  locale: { type: 'string', minLength: 2, maxLength: 12, description: 'BCP 47 locale, for example ja-JP.' },
  latitude: { type: 'number', minimum: -90, maximum: 90, description: 'Geolocation latitude; give with longitude.' },
  longitude: { type: 'number', minimum: -180, maximum: 180, description: 'Geolocation longitude.' },
  network: { type: 'string', enum: networkNames, description: `Throttling profile: ${networkNames.join(', ')}.` },
  cpu_throttle: { type: 'number', minimum: 1, maximum: 20, description: 'CPU slowdown multiplier; 1 is no throttling.' }
}

export function cdpEmulateTool(cdp: CdpHostProvider): ToolDefinition {
  return defineActionTool({
    name: 'emulate',
    description:
      'Change the device and environment a page believes it is running in, then verify it from inside ' +
      'the page. Viewport resizing goes through the embedder rather than the protocol: Blink applies ' +
      'CDP\'s screen metrics, but the layout viewport of a tab hosted in a WebContentsView follows the ' +
      'native widget, so `Emulation.setDeviceMetricsOverride` alone leaves innerWidth untouched and a ' +
      'responsive site keeps serving desktop layout. This tool drives Electron\'s own device emulation ' +
      'for size and CDP for user agent, colour scheme, reduced motion, timezone, locale, geolocation, ' +
      'network throttling and CPU slowdown. Every result includes what the page measured afterwards, so ' +
      'an override that did not land is visible rather than assumed. Overrides persist across ' +
      'navigations on that tab until reset.',
    actions: actions(cdp)
  })
}

function actions(cdp: CdpHostProvider): ToolAction[] {
  return [
    {
      action: 'apply',
      description:
        'Apply the named overrides to a tab and return which were applied plus the page\'s own reading ' +
        'of viewport, screen, pixel ratio, touch points, user agent, language, timezone, colour scheme ' +
        'and online state. Fields are independent: send only what you want changed.',
      inputSchema: objectSchema(applyProperties),
      run: async (input) => jsonResult(await requireCdp(cdp).emulate(tabIdFrom(input), requestFrom(input)))
    },
    {
      action: 'reset',
      description:
        'Clear every override on the tab — viewport, user agent, media features, timezone, locale, ' +
        'geolocation, CPU and network throttling — and return the page\'s reading afterwards.',
      inputSchema: objectSchema({ tab_id: tabIdField }),
      run: async (input) => jsonResult(await requireCdp(cdp).emulate(tabIdFrom(input), null))
    }
  ]
}

function requestFrom(input: JsonObject): EmulateRequest {
  const request: EmulateRequest = {
    device: stringArg(input, 'device'),
    userAgent: stringArg(input, 'user_agent'),
    colorScheme: stringArg(input, 'color_scheme') as 'light' | 'dark' | undefined,
    timezone: stringArg(input, 'timezone'),
    locale: stringArg(input, 'locale'),
    network: stringArg(input, 'network')
  }
  if (typeof input.width === 'number') request.width = input.width
  if (typeof input.height === 'number') request.height = input.height
  if (typeof input.device_scale_factor === 'number') request.deviceScaleFactor = input.device_scale_factor
  if (typeof input.mobile === 'boolean') request.mobile = booleanArg(input, 'mobile', false)
  if (typeof input.reduced_motion === 'boolean') request.reducedMotion = booleanArg(input, 'reduced_motion', false)
  if (typeof input.latitude === 'number') request.latitude = input.latitude
  if (typeof input.longitude === 'number') request.longitude = input.longitude
  if (typeof input.cpu_throttle === 'number') request.cpuThrottle = input.cpu_throttle
  return request
}
