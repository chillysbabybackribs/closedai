import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { encoderArgs, ffmpegBinary, startEncoder } from './ffmpeg-encoder.js'

const hasFfmpeg = (() => { try { execFileSync(ffmpegBinary(), ['-version'], { stdio: 'ignore' }); return true } catch { return false } })()

test('encoder args read raw BGRA from stdin and pad or cut audio to the picture', () => {
  const video = encoderArgs({ output: '/w/out.mp4', width: 640, height: 360, fps: 24 })
  assert.deepEqual(video.slice(video.indexOf('-f'), video.indexOf('-i') + 2), ['-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', '640x360', '-r', '24', '-i', 'pipe:0'])
  assert.equal(video.at(-1), '/w/out.mp4')
  assert.ok(!video.includes('-shortest'))
  const withAudio = encoderArgs({ output: '/w/out.mp4', width: 640, height: 360, fps: 24, audio: '/w/song.mp3' })
  assert.deepEqual(withAudio.slice(withAudio.indexOf('/w/song.mp3') - 1, withAudio.indexOf('-shortest') + 1), [
    '-i', '/w/song.mp3', '-map', '0:v:0', '-map', '1:a:0', '-af', 'apad', '-c:a', 'aac', '-b:a', '192k', '-shortest'
  ])
})

test('a missing ffmpeg names the fix', async () => {
  const encoder = startEncoder({ output: '/tmp/never.mp4', width: 2, height: 2, fps: 1, binary: '/nonexistent/ffmpeg' })
  await assert.rejects(encoder.finish(), /ffmpeg was not found .*CLOSEDAI_FFMPEG/)
})

test('frames written to the encoder become an H.264 MP4', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'closedai-encoder-'))
  const output = path.join(dir, 'out.mp4')
  const encoder = startEncoder({ output, width: 16, height: 16, fps: 5 })
  for (let frame = 0; frame < 5; frame++) await encoder.write(Buffer.alloc(16 * 16 * 4, frame * 40))
  await encoder.finish()
  assert.ok((await stat(output)).size > 0)
  const probe = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,nb_read_frames', '-of', 'csv=p=0', output]).toString().trim()
  assert.equal(probe, 'h264,5')
})

test('ffmpeg errors surface with its own message', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
  const encoder = startEncoder({ output: '/tmp/x.mp4', width: 16, height: 16, fps: 5, audio: '/nonexistent/song.mp3' })
  await assert.rejects(encoder.finish(), /ffmpeg exited with \d+: [\s\S]*song\.mp3/)
})
