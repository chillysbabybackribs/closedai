import { ChangeSet, type ChangeSpec, type Text } from '@codemirror/state'
import type { NoteChange, NoteDoc, NoteSaveResult } from '../../shared/notes.js'

// Keeps one editor buffer and main's copy of a note in step while both change. Main's text at a
// revision is the base; the user's typing since is a change set over it. A model edit arrives as
// main's new text: the difference from the base is rebased over the unsaved typing and applied to
// the buffer, so neither side's work is lost, and the next save names the new revision. Only one
// save is in flight; typing meanwhile waits for the next.

export type NoteSyncHost = {
  save: (id: string, text: string, baseRevision: number) => Promise<NoteSaveResult>
  /** The buffer as it is now. */
  doc: () => Text
  /** Apply main's change to the buffer, already rebased over unsaved typing. */
  applyRemote: (changes: ChangeSet, change: NoteChange) => void
  onError: (reason: unknown) => void
}

const SAVE_DELAY_MS = 300

export class NoteSync {
  private base: { text: string; revision: number }
  /** Base → buffer: everything typed that main has not accepted. */
  private pending: ChangeSet
  private inflight: { text: string; revision: number } | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(readonly noteId: string, note: Pick<NoteDoc, 'text' | 'revision'>, private readonly host: NoteSyncHost) {
    this.base = { text: note.text, revision: note.revision }
    this.pending = ChangeSet.empty(note.text.length)
  }

  get revision(): number {
    return this.base.revision
  }

  get dirty(): boolean {
    return !this.pending.empty
  }

  /** Where a position in main's text sits in the buffer, past any unsaved typing. */
  toBuffer(position: number): number {
    return this.pending.mapPos(position, 1)
  }

  /** The user changed the buffer. */
  typed(changes: ChangeSet): void {
    this.pending = this.pending.compose(changes)
    this.schedule()
  }

  /** A change main accepted: our own save's echo, or someone else's to fold in. */
  received(change: NoteChange): void {
    if (change.note.id !== this.noteId || change.text === null || change.note.revision <= this.base.revision) return
    if (this.inflight && change.text === this.inflight.text && change.origin === 'editor') {
      this.accepted(change.text, change.note.revision)
      return
    }
    const remote = diff(this.base.text, change.text)
    // Remote wins ties at the same position, so typing sits after the model's insertion.
    const forBuffer = remote.map(this.pending)
    this.pending = this.pending.map(remote, true)
    this.base = { text: change.text, revision: change.note.revision }
    this.host.applyRemote(forBuffer, change)
    if (this.dirty) this.schedule()
  }

  /** Save now, e.g. before the tab closes. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.inflight || !this.dirty || this.disposed) return
    const text = this.host.doc().toString()
    const sent = { text, revision: this.base.revision }
    this.inflight = sent
    try {
      const result = await this.host.save(this.noteId, text, sent.revision)
      // A refusal means a model edit landed first; its change event rebased the buffer already.
      if (result.ok && this.inflight === sent) this.accepted(text, result.note.revision)
    } catch (reason) {
      this.host.onError(reason)
    } finally {
      if (this.inflight === sent) this.inflight = null
      if (this.dirty) this.schedule()
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private accepted(text: string, revision: number): void {
    if (revision <= this.base.revision) return
    const current = this.host.doc().toString()
    this.base = { text, revision }
    this.inflight = null
    // Whatever was typed after the save went out is still unsaved, now over the new base.
    this.pending = current === text ? ChangeSet.empty(text.length) : diff(text, current)
  }

  private schedule(): void {
    if (this.timer || this.disposed) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, SAVE_DELAY_MS)
  }
}

/** One replacement between the common prefix and suffix; model edits touch one region at a time. */
export function diff(from: string, to: string): ChangeSet {
  if (from === to) return ChangeSet.empty(from.length)
  let start = 0
  const limit = Math.min(from.length, to.length)
  while (start < limit && from.charCodeAt(start) === to.charCodeAt(start)) start += 1
  let end = 0
  while (end < limit - start && from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)) end += 1
  const spec: ChangeSpec = { from: start, to: from.length - end, insert: to.slice(start, to.length - end) }
  return ChangeSet.of(spec, from.length)
}
