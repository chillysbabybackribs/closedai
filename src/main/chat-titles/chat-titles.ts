import type { ChatSnapshot } from '../../shared/chat.js'
import type { ChatStore } from '../chat-store/chat-store.js'
import { cleanGeneratedTitle, titleRequest, type TitleGenerator } from './title-policy.js'

/** One bounded background request per chat. Its result never changes conversation activity. */
export class ChatTitles {
  private readonly pending = new Map<string, AbortController>()

  constructor(private readonly store: ChatStore, private readonly changed: (id: string) => void) {}

  async generate(id: string, snapshot: ChatSnapshot, generate: TitleGenerator): Promise<void> {
    const record = this.store.get(id)
    if (!record || record.archived || record.titleGenerationAttempted || record.titleSource === 'generated' ||
      record.titleSource === 'manual' || this.pending.has(id) || !record.threadId) return
    const request = titleRequest(snapshot)
    if (!request) return
    const threadId = record.threadId
    const controller = new AbortController()
    this.pending.set(id, controller)
    this.store.update(id, { titleGenerationAttempted: true })
    const timer = setTimeout(() => controller.abort(), 45_000)
    try {
      const title = cleanGeneratedTitle(await generate(request, controller.signal))
      const current = this.store.get(id)
      if (!title || controller.signal.aborted || !current || current.archived || current.threadId !== threadId ||
        current.modelId !== record.modelId || current.titleSource === 'manual' || current.titleSource === 'generated') return
      this.store.update(id, { title, titleSource: 'generated' })
      this.changed(id)
    } catch {
      // Naming is best-effort; a failed request keeps the existing title and does not retry every turn.
    } finally {
      clearTimeout(timer)
      if (this.pending.get(id) === controller) this.pending.delete(id)
    }
  }

  cancel(id: string): void {
    this.pending.get(id)?.abort()
    this.pending.delete(id)
  }
}
