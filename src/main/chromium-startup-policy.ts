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

  // Keep GPU compositing and WebGL enabled, but avoid Linux drivers that advertise
  // accelerated H.264 decode while returning zero-filled frames. Chromium owns this
  // narrow switch: https://source.chromium.org/chromium/chromium/src/+/main:content/public/common/content_switches.cc
  if (env.CLOSEDAI_KEEP_HARDWARE_VIDEO_DECODE !== '1') {
    app.commandLine.appendSwitch('disable-accelerated-video-decode')
  }
}
