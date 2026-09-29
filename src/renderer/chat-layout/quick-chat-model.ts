// The browser's quick chat keeps a model of its own: a new quick chat (first open, Clear chat, a new
// space) starts on the model last used in one, not on whichever tile has focus. Stored in the main
// window's localStorage, which the quick chat layer shares.

const KEY = 'closedai.quickChat.modelId'

export function readQuickChatModel(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    return storage.getItem(KEY) || null
  } catch {
    return null
  }
}

export function rememberQuickChatModel(storage: Pick<Storage, 'setItem'>, modelId: string): void {
  try {
    storage.setItem(KEY, modelId)
  } catch {
    // Storage full or unavailable: the next quick chat falls back to the focused tile's model.
  }
}
