import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'

// Raw BGRA frames go in on stdin; ffmpeg writes H.264 in an MP4 the embedded browser and every
// common player can open. An optional audio track is padded with silence and cut at the end of
// the picture, so a short jingle never shortens the video and a long song never extends it.

export type EncoderOptions = {
  output: string
  width: number
  height: number
  fps: number
  audio?: string
  /** Defaults to CLOSEDAI_FFMPEG or `ffmpeg` on PATH. */
  binary?: string
}

export type FrameEncoder = {
  /** Resolves when ffmpeg has accepted the frame (respects pipe backpressure). */
  write(frame: Buffer): Promise<void>
  /** Close stdin and wait for a clean exit; rejects with ffmpeg's own error text. */
  finish(): Promise<void>
  kill(): void
}

const STDERR_TAIL = 4_000

export function ffmpegBinary(options: Pick<EncoderOptions, 'binary'> = {}): string {
  return options.binary ?? process.env.CLOSEDAI_FFMPEG ?? 'ffmpeg'
}

export function encoderArgs(options: EncoderOptions): string[] {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${options.width}x${options.height}`, '-r', String(options.fps), '-i', 'pipe:0'
  ]
  if (options.audio) args.push('-i', options.audio, '-map', '0:v:0', '-map', '1:a:0', '-af', 'apad', '-c:a', 'aac', '-b:a', '192k', '-shortest')
  args.push(
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-f', 'mp4', options.output
  )
  return args
}

export function startEncoder(options: EncoderOptions): FrameEncoder {
  const binary = ffmpegBinary(options)
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(binary, encoderArgs(options), { stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (error) {
    throw missingBinary(binary, error)
  }
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL) })
  child.stdout.resume()
  // A broken pipe surfaces through `exited`; keep it from becoming an unhandled stream error.
  child.stdin.on('error', () => {})
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', (error) => reject(missingBinary(binary, error)))
    child.once('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg ${signal ? `was stopped (${signal})` : `exited with ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
    })
  })
  exited.catch(() => {})
  let closed = false
  return {
    async write(frame) {
      if (closed || child.exitCode !== null) return exited
      if (!child.stdin.write(frame)) await Promise.race([once(child.stdin, 'drain'), exited])
    },
    async finish() {
      if (!closed) { closed = true; child.stdin.end() }
      return exited
    },
    kill() {
      closed = true
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  }
}

function missingBinary(binary: string, error: unknown): Error {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOENT') {
    return new Error(`ffmpeg was not found (${binary}). Install it (for example \`sudo apt install ffmpeg\`) or set CLOSEDAI_FFMPEG to its path.`)
  }
  return error instanceof Error ? error : new Error(String(error))
}
