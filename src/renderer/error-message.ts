/**
 * The message a user should read from a failed operation: the underlying reason without the
 * `Error invoking remote method 'channel':` prefix Electron adds to ipcMain.handle rejections,
 * without a leading error-class name, and bounded so it fits an inline alert.
 */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  const text = (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']*': /, '')
    .replace(/^\w*Error: /, '')
    .trim()
  const message = text || fallback
  return message.length > 140 ? `${message.slice(0, 139).trimEnd()}…` : message
}
