import { titleQueue } from './title-queue.js'
import type { ChatSnapshot } from '../../shared/chat.js'
import type { ChatStore } from '../chat-store/chat-store.js'
import { cleanGeneratedTitle, titleRequest, type TitleGenerator } from './title-policy.js'

/** One bounded background request per chat. Its result never changes conversation activity. */
export class ChatTitles {
  private readonly pending = new Map<string, AbortController>()

  constructor(private readonly store: ChatStore, private readonly changed: (id: string) => void,
    private readonly autoEnabled: () => boolean = () => true) {}

  async generate(id: string, snapshot: ChatSnapshot, generate: TitleGenerator, automatic = true): Promise<void> {
    if (automatic && !this.autoEnabled()) return
    const record = this.store.get(id)
    const threadId = record?.threadId ?? snapshot.threadId
    if (!record || record.archived || record.titleGenerationAttempted || record.titleSource === 'generated' ||
      record.titleSource === 'manual' || this.pending.has(id) || !threadId) return
    const request = titleRequest(snapshot)
    if (!request) return
    const controller = new AbortController()
    this.pending.set(id, controller)
    try {
      const result = await titleQueue.run(async () => {
        const current = this.store.get(id)
        if (!current || current.archived || current.modelId !== record.modelId || current.threadId !== record.threadId
          || current.titleSource === 'manual' || (automatic && !this.autoEnabled())) return null
        this.store.update(id, { titleGenerationAttempted: true })
        const timer = setTimeout(() => controller.abort(), 45_000)
        try { return await generate(request, controller.signal) } finally { clearTimeout(timer) }
      }, controller.signal)
      const title = cleanGeneratedTitle(result)
      const current = this.store.get(id)
      if (!title || controller.signal.aborted || !current || current.archived ||
        (threadId && current.threadId && current.threadId !== threadId) ||
        current.modelId !== record.modelId || current.titleSource === 'manual' || current.titleSource === 'generated') return
      this.store.update(id, { title, titleSource: 'generated' })
      this.changed(id)
    } catch {
      // Naming is best-effort; a failed request keeps the existing title and does not retry every turn.
    } finally {
      if (this.pending.get(id) === controller) this.pending.delete(id)
    }
  }

  rename(id: string, title: string | null): void {
    const record = this.store.get(id)
    if (!record || record.archived) return
    const trimmed = title?.trim() || null
    this.cancel(id)
    if (trimmed) {
      this.store.update(id, { title: trimmed, titleSource: 'manual' })
    } else {
      this.store.update(id, { title: null, titleSource: null, titleGenerationAttempted: false })
    }
    this.changed(id)
  }

  async retry(id: string, snapshot: ChatSnapshot, generate: TitleGenerator): Promise<void> {
    const record = this.store.get(id)
    if (!record || record.archived || !record.threadId) return
    this.cancel(id)
    this.store.update(id, { titleGenerationAttempted: false, titleSource: null })
    return this.generate(id, snapshot, generate, false)
  }

  cancel(id: string): void {
    this.pending.get(id)?.abort()
    this.pending.delete(id)
  }
}
