interface ChromiumStartupApp {
  commandLine: {
    appendSwitch(name: string, value?: string): void
  }
}

const SPARE_RENDERER = 'SpareRendererForSitePerProcess'

/** Chromium switches that must be set before app.whenReady(). */
export function configureChromiumStartup(
  app: ChromiumStartupApp,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): void {
  // Sandboxed tab views benefit from a warm spare renderer so new tabs skip process launch.
  // https://www.electronjs.org/docs/latest/tutorial/performance
  app.commandLine.appendSwitch('enable-features', SPARE_RENDERER)

  if (platform !== 'linux') return

  // Avoid portal file-transfer/MIME negotiation paths that emit atom-cache warnings.
  env.GTK_USE_PORTAL = '0'
  app.commandLine.appendSwitch('xdg-portal-required-version', '999')
  app.commandLine.appendSwitch('no-sandbox')

  // Some Linux driver stacks accept accelerated H.264 decode but return zero-filled
  // frames after the initial paint. The media element keeps advancing without an
  // error, leaving a blank video surface, so use the reliable software decoder by
  // default. Known-good machines can opt back in explicitly.
  if (!linuxHardwareVideoDecodeEnabled(env)) {
    app.commandLine.appendSwitch('disable-accelerated-video-decode')
  }
}

/** Whether to leave Linux hardware video decode enabled at startup. */
export function linuxHardwareVideoDecodeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CLOSEDAI_DISABLE_HARDWARE_VIDEO_DECODE === '1') return false
  return env.CLOSEDAI_KEEP_HARDWARE_VIDEO_DECODE === '1'
}
