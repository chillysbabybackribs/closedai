const KEY = 'closedai.notepadChat.modelId'

export function readNotepadChatModel(storage: Pick<Storage, 'getItem'>, key = KEY): string | null {
  try {
    const value = storage.getItem(key)
    return typeof value === 'string' && value ? value : null
  } catch {
    return null
  }
}

export function rememberNotepadChatModel(storage: Pick<Storage, 'setItem'>, modelId: string, key = KEY): void {
  try { storage.setItem(key, modelId) } catch { /* Best-effort preference. */ }
}
