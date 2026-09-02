import type { JSX } from 'react'
import { Camera } from 'lucide-react'
import { Message } from '../components/ui/message.js'
import type { ChatTranscriptItem } from '../shared/chat.js'

type ScreenshotItem = Extract<ChatTranscriptItem, { type: 'screenshot' }>

export function ChatScreenshot({ item }: { item: ScreenshotItem }): JSX.Element {
  const surface = item.surface === 'app_window' ? 'Application window' : 'Browser page'
  return (
    <Message className="prompt-message prompt-message-screenshot">
      <figure className="prompt-screenshot">
        <img src={item.imageUrl} alt={`${surface} screenshot`} loading="lazy" />
        <figcaption>
          <Camera aria-hidden="true" />
          <span>{surface}</span>
          {item.caption && <small>{item.caption}</small>}
        </figcaption>
      </figure>
    </Message>
  )
}
