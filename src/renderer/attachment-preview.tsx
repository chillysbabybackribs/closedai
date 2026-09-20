import { useState } from 'react'
import { localFilePath } from '../shared/local-files.js'

export type ImagePreviewTarget = { src: string; name: string }

/** All attachment previews share the browser pane's image tabs. */
export function useImagePreview() {
  const [error, setError] = useState('')
  const open = (target: ImagePreviewTarget): void => {
    setError('')
    const action = localFilePath(target.src)
      ? window.closedai.localFiles.open(target.src)
      : window.closedai.localFiles.openImage(target)
    void action.catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not open this image.'))
  }
  return { open, error }
}
