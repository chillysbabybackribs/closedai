import type { JSX } from 'react'
import { Camera, Image } from 'lucide-react'
import { Message } from '../components/ui/message.js'
import type { ChatTranscriptItem } from '../shared/chat.js'
import { useImagePreview } from './attachment-preview.js'

type ScreenshotItem = Extract<ChatTranscriptItem, { type: 'screenshot' }>

export function ChatScreenshot({ item }: { item: ScreenshotItem }): JSX.Element {
  const preview = useImagePreview()
  const generated = item.surface === 'generated_image'
  const surface = generated ? 'Generated image' : item.surface === 'app_window' || item.surface === 'agent_workspace'
    ? 'Application window'
    : item.surface === 'browser_page' ? 'Browser page' : 'Screenshot crop'
  return (
    <Message className="message prompt-message prompt-message-screenshot">
      <figure className="prompt-screenshot">
        {generated ? (
          <button type="button" className="prompt-generated-image" data-ui="chat.generated-image"
            data-ui-key={item.id} aria-label="Open generated image"
            onClick={() => preview.open({ src: item.savedPath || item.imageUrl, name: 'Generated image' })}>
            <img src={item.imageUrl} alt="Generated image" loading="lazy" />
          </button>
        ) : <img src={item.imageUrl} alt={`${surface} screenshot`} loading="lazy" />}
        <figcaption>
          {generated ? <Image aria-hidden="true" /> : <Camera aria-hidden="true" />}
          <span>{surface}</span>
          {item.caption && <small>{item.caption}</small>}
        </figcaption>
      </figure>
      {preview.error && <span role="alert">{preview.error}</span>}
    </Message>
  )
}
