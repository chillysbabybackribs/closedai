import type { WebContents } from 'electron'

/** A capture cannot be attributed to its readiness probe after a main-frame navigation.
 * Watch events rather than just URLs: reloads and away/back navigations also invalidate it.
 * This does not freeze DOM, animation, video, canvas, or subframe content.
 */
export async function withCaptureDocument<T>(
  contents: Pick<WebContents, 'on' | 'removeListener' | 'isDestroyed'>,
  capture: () => Promise<T>
): Promise<T> {
  let invalidated = false
  const navigation = (_event: unknown, _url: string, _inPlace: boolean, mainFrame: boolean) => {
    if (mainFrame) invalidated = true
  }
  const lost = () => { invalidated = true }
  if (contents.isDestroyed()) throw new Error('The tab closed before capture')
  contents.on('did-start-navigation', navigation)
  contents.on('render-process-gone', lost)
  contents.on('destroyed', lost)
  try {
    const result = await capture()
    if (invalidated || contents.isDestroyed()) {
      throw new Error('The main page navigated or its renderer disappeared during capture; wait for readiness and retry')
    }
    return result
  } finally {
    contents.removeListener('did-start-navigation', navigation)
    contents.removeListener('render-process-gone', lost)
    contents.removeListener('destroyed', lost)
  }
}
