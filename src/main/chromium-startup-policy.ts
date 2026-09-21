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

  // The Chromium sandbox stays on. A machine whose kernel forbids unprivileged user namespaces
  // and whose chrome-sandbox helper is not SUID cannot start it; that machine opts out explicitly
  // (the launcher exports ELECTRON_DISABLE_SANDBOX for the same variable). Never a default.
  if (chromiumSandboxDisabled(env)) app.commandLine.appendSwitch('no-sandbox')

  if (platform !== 'linux') return

  // Avoid portal file-transfer/MIME negotiation paths that emit atom-cache warnings.
  env.GTK_USE_PORTAL = '0'
  app.commandLine.appendSwitch('xdg-portal-required-version', '999')

  // Some Linux driver stacks accept accelerated H.264 decode but return zero-filled
  // frames after the initial paint. The media element keeps advancing without an
  // error, leaving a blank video surface, so use the reliable software decoder by
  // default. Known-good machines can opt back in explicitly.
  if (!linuxHardwareVideoDecodeEnabled(env)) {
    app.commandLine.appendSwitch('disable-accelerated-video-decode')
  }
}

/** The one escape hatch from the Chromium sandbox: `CLOSEDAI_NO_SANDBOX=1`, per machine, never a default. */
export function chromiumSandboxDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLOSEDAI_NO_SANDBOX === '1'
}

/** Whether to leave Linux hardware video decode enabled at startup. */
export function linuxHardwareVideoDecodeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CLOSEDAI_DISABLE_HARDWARE_VIDEO_DECODE === '1') return false
  return env.CLOSEDAI_KEEP_HARDWARE_VIDEO_DECODE === '1'
}
