import { BrowserWindow } from 'electron'
import { rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { startEncoder, type FrameEncoder } from './ffmpeg-encoder.js'
import { VIDEO_CLOCK_GLOBAL, videoClockSource } from './video-clock.js'

// Records a page to MP4 by stepping its virtual clock one frame at a time in an offscreen
// window the app owns, copying each composited frame, and streaming the pixels into ffmpeg.
// The window never appears, uses its own in-memory session, and cannot open or follow links.

export type PageVideoRequest = {
  url: string
  /** Final .mp4 path; the file appears only after a successful encode. */
  output: string
  width: number
  height: number
  fps: number
  durationMs: number
  audio?: string
}

export type PageVideoResult = { frames: number; bytes: number }

const LOAD_TIMEOUT_MS = 30_000
const STEP_TIMEOUT_MS = 15_000

export function frameCount(durationMs: number, fps: number): number {
  return Math.max(1, Math.round((durationMs / 1000) * fps))
}

export async function recordPageVideo(
  request: PageVideoRequest,
  signal: AbortSignal,
  onFrame: (done: number, total: number) => void
): Promise<PageVideoResult> {
  const total = frameCount(request.durationMs, request.fps)
  const partial = path.join(path.dirname(request.output), `.${path.basename(request.output)}.rendering`)
  const window = new BrowserWindow({
    show: false, width: request.width, height: request.height, useContentSize: true, frame: false,
    enableLargerThanScreen: true, paintWhenInitiallyHidden: true,
    webPreferences: {
      offscreen: { deviceScaleFactor: 1 }, partition: 'closedai-video-render', sandbox: true,
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false
    }
  })
  const contents = window.webContents
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
  const stop = (): void => { if (!window.isDestroyed()) window.destroy() }
  signal.addEventListener('abort', stop, { once: true })
  let encoder: FrameEncoder | null = null
  try {
    contents.setFrameRate(60)
    // The debugger only answers once the contents has a live renderer.
    await contents.loadURL('about:blank')
    contents.debugger.attach('1.3')
    await contents.debugger.sendCommand('Page.enable')
    await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: videoClockSource() })
    await contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: request.width, height: request.height, deviceScaleFactor: 1, mobile: false
    })
    await contents.debugger.sendCommand('Emulation.setScrollbarsHidden', { hidden: true })
    await withTimeout(contents.loadURL(request.url), LOAD_TIMEOUT_MS, 'The page did not finish loading')
    await withTimeout(contents.executeJavaScript(`window.${VIDEO_CLOCK_GLOBAL}.prepare()`), STEP_TIMEOUT_MS, 'The page did not settle after load')
    encoder = startEncoder({ output: partial, width: request.width, height: request.height, fps: request.fps, audio: request.audio })
    for (let index = 0; index < total; index++) {
      signal.throwIfAborted()
      const ms = (index * 1000) / request.fps
      await withTimeout(contents.executeJavaScript(`window.${VIDEO_CLOCK_GLOBAL}.step(${ms})`), STEP_TIMEOUT_MS, `Frame ${index} did not paint`)
      await encoder.write(await frameBitmap(contents, request.width, request.height))
      onFrame(index + 1, total)
    }
    await encoder.finish()
    await rename(partial, request.output)
    return { frames: total, bytes: (await stat(request.output)).size }
  } catch (error) {
    encoder?.kill()
    await rm(partial, { force: true })
    if (signal.aborted) throw new Error('Render cancelled')
    throw error
  } finally {
    signal.removeEventListener('abort', stop)
    if (!window.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach()
    stop()
  }
}

async function frameBitmap(contents: Electron.WebContents, width: number, height: number): Promise<Buffer> {
  let image = await contents.capturePage()
  const size = image.getSize()
  if (image.isEmpty()) throw new Error('The offscreen page produced an empty frame')
  if (size.width !== width || size.height !== height) image = image.resize({ width, height, quality: 'best' })
  // Electron bitmaps are BGRA, matching the encoder's input format.
  return image.toBitmap()
}

async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${message} within ${ms / 1000}s`)), ms) })
  try {
    return await Promise.race([work, expired])
  } finally {
    clearTimeout(timer)
  }
}
