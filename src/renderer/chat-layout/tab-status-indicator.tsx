import { CircleAlert, LoaderCircle, Pause } from 'lucide-react'
import type { TabActivity } from './tab-activity.js'

export function TabStatusIndicator({ status }: { status: TabActivity | undefined }) {
  if (!status || status.state === 'idle') return null
  return <span className="chat-tab-indicator" aria-hidden="true">
    {status.state === 'working' ? <LoaderCircle className="chat-tab-spinner" size={16} />
      : status.state === 'paused' ? <Pause size={16} />
        : status.state === 'failed' ? <CircleAlert size={16} />
          : <i className="chat-tab-unread" />}
  </span>
}
