import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow } from 'electron'
import { BrowserService } from '../src/main/browser-service.js'
import { EPHEMERAL_BROWSER_HISTORY } from '../src/main/browser-history-store.js'
import { recordPageVideo } from '../src/main/video-render/page-recorder.js'

const root = process.env.CLOSEDAI_VIDEO_CHECK_ROOT
if (!root) throw new Error('Run through scripts/video-render-live-check.mjs')
app.setPath('userData', join(root, 'profile'))
// The recorder's offscreen window is the only window; closing it must not quit the fixture.
app.on('window-all-closed', () => {})
const watchdog = setTimeout(() => { console.error('Video render fixture exceeded sixty seconds'); app.exit(1) }, 60_000)

const WIDTH = 320
const HEIGHT = 180
const FPS = 10
// Left: CSS keyframes, red for the first second then blue. Middle: a timer turns it green at
// 1.5s. Right: a requestAnimationFrame loop turns it white once performance.now() passes 700ms.
const PAGE = `<!doctype html><style>
  html,body{margin:0;width:100%;height:100%;background:#000}
  div{position:absolute;top:0;bottom:0;width:33%}
  #css{left:0;animation:flip 2s linear forwards}
  @keyframes flip{0%,49.9%{background:#f00}50%,100%{background:#00f}}
  #timer{left:33%} #raf{left:66%}
</style><div id="css"></div><div id="timer"></div><div id="raf"></div><script>
  setTimeout(() => { document.getElementById('timer').style.background = '#0f0' }, 1500)
  const loop = (t) => { if (t >= 700) document.getElementById('raf').style.background = '#fff'; requestAnimationFrame(loop) }
  requestAnimationFrame(loop)
</script>`

type Rgb = [number, number, number]
const near = (actual: Rgb, expected: Rgb) => actual.every((value, index) => Math.abs(value - expected[index]!) < 40)

function framePixels(file: string, frame: number): { css: Rgb; timer: Rgb; raf: Rgb } {
  const raw = execFileSync('ffmpeg', [
    '-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
  ], { maxBuffer: 64 * 1024 * 1024 })
  const at = (x: number): Rgb => {
    const offset = (Math.floor(HEIGHT / 2) * WIDTH + x) * 3
    return [raw[offset]!, raw[offset + 1]!, raw[offset + 2]!]
  }
  return { css: at(Math.floor(WIDTH * 0.15)), timer: at(Math.floor(WIDTH * 0.5)), raf: at(Math.floor(WIDTH * 0.85)) }
}

app.whenReady().then(async () => {
  const page = join(root, 'page.html')
  writeFileSync(page, PAGE)
  const output = join(root, 'out.mp4')
  const progress: number[] = []
  const started = Date.now()
  const result = await recordPageVideo(
    { url: pathToFileURL(page).href, output, width: WIDTH, height: HEIGHT, fps: FPS, durationMs: 2_000 },
    new AbortController().signal,
    (done) => progress.push(done)
  )
  assert.equal(result.frames, 20)
  assert.ok(result.bytes > 0)
  assert.deepEqual(progress, Array.from({ length: 20 }, (_, index) => index + 1))
  const probe = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames,width,height,codec_name,pix_fmt', '-of', 'json', output]).toString()
  const stream = JSON.parse(probe).streams[0]
  assert.deepEqual([stream.codec_name, stream.width, stream.height, stream.pix_fmt, Number(stream.nb_read_frames)], ['h264', WIDTH, HEIGHT, 'yuv420p', 20])

  const red: Rgb = [255, 0, 0], blue: Rgb = [0, 0, 255], black: Rgb = [0, 0, 0], green: Rgb = [0, 255, 0], white: Rgb = [255, 255, 255]
  const expectations: Array<[number, Rgb, Rgb, Rgb]> = [
    [0, red, black, black], [6, red, black, black], [7, red, black, white],
    [9, red, black, white], [10, blue, black, white], [14, blue, black, white], [15, blue, green, white], [19, blue, green, white]
  ]
  for (const [frame, css, timer, raf] of expectations) {
    const pixels = framePixels(output, frame)
    assert.ok(near(pixels.css, css), `frame ${frame} css ${pixels.css} expected ${css}`)
    assert.ok(near(pixels.timer, timer), `frame ${frame} timer ${pixels.timer} expected ${timer}`)
    assert.ok(near(pixels.raf, raf), `frame ${frame} raf ${pixels.raf} expected ${raf}`)
  }

  // The embedded browser opens the result as a playing media document, not a failed load.
  const window = new BrowserWindow({ show: false, width: 800, height: 600 })
  const browser = new BrowserService(window, EPHEMERAL_BROWSER_HISTORY, { initialUrl: 'about:blank' })
  browser.setBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
  const videoTab = await browser.navigateTab(pathToFileURL(output).href, true)
  const player = await browser.contentsOf(videoTab)!.executeJavaScript(
    `new Promise((r) => { const v = document.querySelector('video'); const done = () => r({ duration: v.duration, error: !!v.error }); v.readyState >= 1 ? done() : v.addEventListener('loadedmetadata', done) })`
  )
  assert.equal(player.error, false)
  assert.ok(Math.abs(player.duration - 2) < 0.2, `player duration ${player.duration}`)
  assert.equal(browser.snapshot().navigationError ?? null, null)
  // Paused at 1.5s the centre of the letterboxed player is the timer strip, green by then.
  await browser.contentsOf(videoTab)!.executeJavaScript(
    `new Promise((r) => { const v = document.querySelector('video'); v.pause(); v.addEventListener('seeked', () => requestAnimationFrame(() => requestAnimationFrame(r)), { once: true }); v.currentTime = 1.5 })`
  )
  const shot = await browser.contentsOf(videoTab)!.capturePage()
  const { width: shotWidth, height: shotHeight } = shot.getSize()
  const bitmap = shot.toBitmap()
  const centre = ((Math.floor(shotHeight / 2) * shotWidth) + Math.floor(shotWidth / 2)) * 4
  const shown: Rgb = [bitmap[centre + 2]!, bitmap[centre + 1]!, bitmap[centre]!]
  // The player's YUV→RGB conversion shifts colour, so assert the dominant channel.
  assert.ok(shown[1] > 180 && shown[0] < 100 && shown[2] < 100, `playing tab centre ${shown} should be green`)
  window.destroy()

  // Cancelling mid-render leaves no file behind.
  const controller = new AbortController()
  const cancelled = join(root, 'cancelled.mp4')
  await assert.rejects(recordPageVideo(
    { url: pathToFileURL(page).href, output: cancelled, width: WIDTH, height: HEIGHT, fps: FPS, durationMs: 2_000 },
    controller.signal, (done) => { if (done === 3) controller.abort() }
  ), /cancelled/)
  assert.deepEqual(execFileSync('ls', ['-A', root]).toString().split('\n').filter((name) => name.includes('cancelled')), [])

  console.error(`video render live check passed (${Date.now() - started}ms)`)
  clearTimeout(watchdog)
  app.exit(0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
