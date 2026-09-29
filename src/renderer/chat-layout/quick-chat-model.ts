// The browser's quick chat keeps a model of its own: a new quick chat (first open, Clear chat, a new
// space) starts on the model last used in one, not on whichever tile has focus. Stored in the main
// window's localStorage, which the quick chat layer shares.

const KEY = 'closedai.quickChat.modelId'

/** `key` names another side chat's memory (a notepad window's chat keeps its own). */
export function readQuickChatModel(storage: Pick<Storage, 'getItem'>, key = KEY): string | null {
  try {
    return storage.getItem(key) || null
  } catch {
    return null
  }
}

export function rememberQuickChatModel(storage: Pick<Storage, 'setItem'>, modelId: string, key = KEY): void {
  try {
    storage.setItem(key, modelId)
  } catch {
    // Storage full or unavailable: the next quick chat falls back to the focused tile's model.
  }
}
