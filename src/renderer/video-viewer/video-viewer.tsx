import type { VideoTabIdentity } from '../../shared/local-files.js'
import { VideoPlayer } from './video-player.js'

export function VideoViewer({ id, active, video }: { id: string; active: boolean; video?: VideoTabIdentity }) {
  return (
    <section className="video-viewer" hidden={!active} role="tabpanel"
      id={`video-page-${id}`} aria-labelledby={`browser-tab-${id}`}>
      <VideoPlayer tabId={id} revision={video?.revision ?? 0} active={active} />
    </section>
  )
}
