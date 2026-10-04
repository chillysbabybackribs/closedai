import type { JSX } from 'react'
import { Image } from './icons/index.js'
import { Message } from '../components/ui/message.js'
import type { ChatTranscriptItem } from '../shared/chat.js'
import { useImagePreview } from './attachment-preview.js'

type ScreenshotItem = Extract<ChatTranscriptItem, { type: 'screenshot' }>

export function ChatScreenshot({ item }: { item: ScreenshotItem }): JSX.Element {
  const preview = useImagePreview()
  // A capture is evidence of a step, not the deliverable: it stays a thumbnail. Only a
  // generated image is shown at size, because it is the answer.
  if (item.surface !== 'generated_image') {
    return (
      <Message className="message prompt-message prompt-message-screenshot">
        <ScreenshotStrip shots={[item]} />
      </Message>
    )
  }
  return (
    <Message className="message prompt-message prompt-message-screenshot">
      <figure className="prompt-screenshot">
        <button type="button" className="prompt-generated-image" data-ui="chat.generated-image"
          data-ui-key={item.id} aria-label="Open generated image"
          onClick={() => preview.open({ src: item.savedPath || item.imageUrl, name: 'Generated image' })}>
          <img src={item.imageUrl} alt="Generated image" decoding="sync" />
        </button>
        <figcaption>
          <Image aria-hidden="true" />
          <span>Generated image</span>
          {item.caption && <small>{item.caption}</small>}
        </figcaption>
      </figure>
      {preview.error && <span role="alert">{preview.error}</span>}
    </Message>
  )
}

/**
 * Captures as a row of fixed-size thumbnails under the step group that took them. Every
 * thumbnail reserves its box before the image decodes, so loading never moves the
 * transcript. A click opens the full image in a browser-pane image tab.
 */
export function ScreenshotStrip({ shots }: { shots: readonly ScreenshotItem[] }): JSX.Element {
  const preview = useImagePreview()
  return (
    <div className="prompt-shot-strip">
      {shots.map((shot) => {
        const surface = surfaceLabel(shot.surface)
        return (
          <button key={shot.id} type="button" className="prompt-shot" data-ui="chat.screenshot" data-ui-key={shot.id}
            aria-label={`Open ${surface.toLowerCase()} screenshot`} title={shot.caption ? `${surface} · ${shot.caption}` : surface}
            onClick={() => preview.open({ src: shot.savedPath || shot.imageUrl, name: surface })}>
            <img src={shot.imageUrl} alt="" decoding="async" />
          </button>
        )
      })}
      {preview.error && <span className="prompt-shot-error" role="alert">{preview.error}</span>}
    </div>
  )
}

function surfaceLabel(surface: ScreenshotItem['surface']): string {
  if (surface === 'app_window' || surface === 'agent_workspace') return 'Application window'
  if (surface === 'browser_page') return 'Browser page'
  return 'Screenshot crop'
}
