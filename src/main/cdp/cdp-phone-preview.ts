import {
  PHONE_DEVICE_SCALE_FACTOR,
  PHONE_SCREEN,
  PHONE_VIEWPORT,
  phonePageScale,
  type PhonePreviewLayout
} from '../../shared/phone-preview.js'
import { DEVICE_PRESETS, type DeviceEmulationTarget, type EmulateSend } from './cdp-emulate.js'

// Phone preview emulation for a tab whose surface the browser service has already placed in the
// drawn phone screen. Measured in this app (2026-10-04): with the surface at the scaled screen
// size, `setDeviceMetricsOverride`'s `scale` renders the full 393px layout into it, but Chromium
// then computes a page scale from the old widget width and zooms in (visualViewport.scale 1.22
// for a 295px surface). Resetting the page scale to 1 shows the whole layout, and it survives a
// reload for pages with `initial-scale=1`. Without `scale`, a fitted (smaller) surface would lay
// the page out narrower than the phone and serve the wrong breakpoint.

/** Apply, or re-apply after a resize changed the fit, the phone metrics for this layout. */
export async function applyPhonePreview(
  target: Pick<DeviceEmulationTarget, 'enableDeviceEmulation'>,
  send: EmulateSend,
  layout: PhonePreviewLayout,
  options: { initial: boolean }
): Promise<void> {
  target.enableDeviceEmulation({
    screenPosition: 'mobile',
    screenSize: { ...PHONE_SCREEN },
    viewSize: { width: layout.page.width, height: layout.page.height },
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: PHONE_DEVICE_SCALE_FACTOR,
    scale: 1
  })
  await send('Emulation.setDeviceMetricsOverride', {
    width: PHONE_VIEWPORT.width,
    height: PHONE_VIEWPORT.height,
    deviceScaleFactor: PHONE_DEVICE_SCALE_FACTOR,
    mobile: true,
    scale: phonePageScale(layout),
    screenWidth: PHONE_SCREEN.width,
    screenHeight: PHONE_SCREEN.height
  })
  if (options.initial) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await send('Emulation.setUserAgentOverride', { userAgent: DEVICE_PRESETS['iphone-15'].userAgent })
  }
  await send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
}

/** Return the page to desktop metrics. Each clear is independent so one failure cannot strand the rest. */
export async function clearPhonePreview(
  target: Pick<DeviceEmulationTarget, 'disableDeviceEmulation'>,
  send: EmulateSend
): Promise<void> {
  target.disableDeviceEmulation()
  const clear = async (method: string, params?: Record<string, unknown>) => {
    await send(method, params).catch(() => {})
  }
  await clear('Emulation.clearDeviceMetricsOverride')
  await clear('Emulation.setTouchEmulationEnabled', { enabled: false })
  await clear('Emulation.setUserAgentOverride', { userAgent: '' })
  await clear('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
}
