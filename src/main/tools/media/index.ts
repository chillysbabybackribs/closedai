import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineActionTool } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { booleanArg, numberArg, stringArg, usageResult, type ToolNamespace } from '../tool.js'
import { requireHost } from '../app/host.js'
import {
  chatCwd, insideCwd, openWorkspacePreview, resolveHtmlPreview, resolveWorkspaceFile, type PreviewHosts
} from '../app/preview-html.js'
import type { PageVideoRequest, PageVideoResult } from '../../video-render/page-recorder.js'
import { VideoJobs, type VideoJobView } from './video-jobs.js'

export { VideoJobs } from './video-jobs.js'

/** The Electron side: record a page URL to an MP4 file. */
export type RecordPageVideo = (
  request: PageVideoRequest, signal: AbortSignal, onFrame: (done: number, total: number) => void
) => Promise<PageVideoResult>

export type MediaHosts = PreviewHosts & { record: RecordPageVideo }

const PLAYABLE = new Set(['.mp4', '.webm'])
const AUDIO = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.flac'])
const MAX_WAIT_S = 45
const DEFAULT_WAIT_S = 20

const waitField = {
  type: 'number', minimum: 0, maximum: MAX_WAIT_S,
  description: `Seconds to wait for the render to finish before returning its progress; default ${DEFAULT_WAIT_S}, max ${MAX_WAIT_S}.`
}
const jobField = { type: 'string', minLength: 1, maxLength: 100, description: 'job_id returned by render.' }

/**
 * media: files the app produces for the user. video renders a workspace HTML page to MP4 on a
 * virtual clock (src/main/video-render/) and plays results in the embedded browser.
 */
export function mediaTools(hosts: MediaHosts, jobs = new VideoJobs()): ToolNamespace {
  const cwdOf = (paneId: string | null | undefined): string => chatCwd(requireHost(hosts.app, 'app commands'), paneId)
  const result = (view: VideoJobView) => ({ ...jsonResult(view), isError: view.state === 'failed' ? true : undefined })
  return {
    name: 'media',
    description: 'Videos made from workspace pages, played in the embedded browser.',
    tools: [
      defineActionTool({
        name: 'video',
        deferLoading: true,
        description:
          'Turn a workspace HTML page into an MP4 (H.264) with ffmpeg, then play it in the embedded browser. ' +
          'The page renders offscreen at width×height CSS pixels with scrollbars hidden, after load and fonts settle. ' +
          'Time is virtual: CSS animations and transitions, Web Animations, setTimeout/setInterval, requestAnimationFrame, ' +
          'Date, performance.now, and <video> elements advance exactly 1/fps per frame however slow capture is, so build ' +
          'the motion with those. Network, image decode, and audio elements are not timed; page audio is not recorded (pass audio). ' +
          'Rendering is a background job: render and status wait up to wait_s, then return progress with a job_id.',
        actions: [
          {
            action: 'render',
            description: 'Start rendering `path` for `duration_s`. Writes `output` (default: the page name with .mp4) only when encoding succeeds, then opens it in a new tab unless open is false. One render runs at a time.',
            timeoutMs: (MAX_WAIT_S + 15) * 1000,
            inputSchema: objectSchema({
              path: { type: 'string', minLength: 1, maxLength: 4096, description: '.html/.htm file relative to the chat cwd or absolute inside it.' },
              duration_s: { type: 'number', minimum: 0.1, maximum: 600, description: 'Video length in seconds.' },
              output: { type: 'string', minLength: 1, maxLength: 4096, description: '.mp4 path inside the cwd; parent folders are created; an existing file is replaced.' },
              fps: { type: 'integer', minimum: 1, maximum: 60, description: 'Frames per second; default 30.' },
              width: { type: 'integer', minimum: 16, maximum: 3840, description: 'Default 1920; rounded up to even.' },
              height: { type: 'integer', minimum: 16, maximum: 2160, description: 'Default 1080; rounded up to even.' },
              audio: { type: 'string', minLength: 1, maxLength: 4096, description: 'Soundtrack file inside the cwd (mp3, m4a, aac, wav, ogg, opus, flac); padded or cut to the video length.' },
              open: { type: 'boolean', description: 'Play the finished video in a new browser tab; default true.' },
              wait_s: waitField
            }, ['path', 'duration_s']),
            run: async (input, context) => {
              const cwd = cwdOf(context.paneId)
              const page = await resolveHtmlPreview(stringArg(input, 'path')!, cwd)
              const outputArg = stringArg(input, 'output') ?? page.path.replace(/\.html?$/i, '.mp4')
              const output = insideCwd(outputArg, cwd)
              if (path.extname(output).toLowerCase() !== '.mp4') return usageResult('media.video render: output must end in .mp4')
              const audioArg = stringArg(input, 'audio')
              const audio = audioArg
                ? (await resolveWorkspaceFile(audioArg, cwd, AUDIO, `audio must be one of ${[...AUDIO].join(', ')}`)).path
                : undefined
              await mkdir(path.dirname(output), { recursive: true })
              const request: PageVideoRequest = {
                url: page.fileUrl, output, audio,
                width: even(numberArg(input, 'width', 1920)), height: even(numberArg(input, 'height', 1080)),
                fps: numberArg(input, 'fps', 30), durationMs: numberArg(input, 'duration_s', 0) * 1000
              }
              const total = Math.max(1, Math.round((request.durationMs / 1000) * request.fps))
              const open = booleanArg(input, 'open', true)
              const started = jobs.start(output, total, (signal, onFrame) => hosts.record(request, signal, onFrame),
                open ? () => openWorkspacePreview({ path: output, fileUrl: pathToFileURL(output).href }, context.paneId, hosts) : undefined)
              return result(await jobs.wait(started.jobId, numberArg(input, 'wait_s', DEFAULT_WAIT_S) * 1000, context.signal))
            }
          },
          {
            action: 'status',
            description: 'Progress of a render (frames, percent, seconds left), waiting up to wait_s for it to finish. A completed job reports bytes and the opened tab.',
            timeoutMs: (MAX_WAIT_S + 15) * 1000,
            inputSchema: objectSchema({ job_id: jobField, wait_s: waitField }, ['job_id']),
            run: async (input, context) => result(await jobs.wait(
              stringArg(input, 'job_id')!, numberArg(input, 'wait_s', DEFAULT_WAIT_S) * 1000, context.signal
            ))
          },
          {
            action: 'cancel',
            description: 'Stop a render; no output file is left behind.',
            inputSchema: objectSchema({ job_id: jobField }, ['job_id']),
            run: async (input) => jsonResult(await jobs.cancel(stringArg(input, 'job_id')!))
          },
          {
            action: 'play',
            description: 'Open an existing .mp4 or .webm under the chat cwd in a new browser tab and show the browser pane.',
            inputSchema: objectSchema({
              path: { type: 'string', minLength: 1, maxLength: 4096, description: 'Video file relative to the chat cwd or absolute inside it.' }
            }, ['path']),
            run: async (input, context) => {
              const file = await resolveWorkspaceFile(stringArg(input, 'path')!, cwdOf(context.paneId), PLAYABLE, 'play opens .mp4 or .webm files')
              return jsonResult(await openWorkspacePreview(file, context.paneId, hosts))
            }
          }
        ]
      })
    ]
  }
}

function even(value: number): number {
  const whole = Math.round(value)
  return whole % 2 === 0 ? whole : whole + 1
}
