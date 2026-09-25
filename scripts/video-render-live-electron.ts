import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app } from 'electron'
import { recordPageVideo } from '../src/main/video-render/page-recorder.js'

const root = process.env.CLOSEDAI_VIDEO_CHECK_ROOT
if (!root) throw new Error('Run through scripts/video-render-live-check.mjs')
app.setPath('userData', join(root, 'profile'))
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

  // Cancelling mid-render leaves no file behind.
  const controller = new AbortController()
  const cancelled = join(root, 'cancelled.mp4')
  await assert.rejects(recordPageVideo(
    { url: pathToFileURL(page).href, output: cancelled, width: WIDTH, height: HEIGHT, fps: FPS, durationMs: 2_000 },
    controller.signal, (done) => { if (done === 3) controller.abort() }
  ), /cancelled/)
  assert.deepEqual(execFileSync('ls', ['-A', root]).toString().split('\n').filter((name) => name.includes('cancelled')), [])

  console.log(`video render live check passed (${Date.now() - started}ms)`)
  clearTimeout(watchdog)
  app.exit(0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
