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

  // Chromium 152+ (Electron 44) retested clean on the target stack; disable only when broken.
  // Legacy escape hatch: CLOSEDAI_KEEP_HARDWARE_VIDEO_DECODE=1 still forces decode on.
  if (!linuxHardwareVideoDecodeEnabled(env)) {
    app.commandLine.appendSwitch('disable-accelerated-video-decode')
  }
}

/** Whether to leave Linux hardware video decode enabled at startup. */
export function linuxHardwareVideoDecodeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CLOSEDAI_DISABLE_HARDWARE_VIDEO_DECODE === '1') return false
  if (env.CLOSEDAI_KEEP_HARDWARE_VIDEO_DECODE === '1') return true
  const chromeMajor = Number.parseInt(process.versions.chrome?.split('.')[0] ?? '0', 10)
  return chromeMajor >= 152
}
