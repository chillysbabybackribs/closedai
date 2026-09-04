import type { JSX } from 'react'
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog.js'

export type ImagePreviewTarget = { src: string; name: string }

/**
 * Full-size view of an attached image, opened by clicking its thumbnail in the composer or the
 * image in a sent message. Escape and the backdrop close it, the same way the rest of the app's
 * dialogs behave.
 */
export function ImagePreviewDialog({
  target,
  onClose
}: {
  target: ImagePreviewTarget | null
  onClose: () => void
}): JSX.Element | null {
  if (!target) return null
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="image-preview" data-ui="dialog.image" aria-describedby={undefined}>
        <DialogTitle className="image-preview-title">{target.name}</DialogTitle>
        <img className="image-preview-image" src={target.src} alt={target.name} />
      </DialogContent>
    </Dialog>
  )
}
