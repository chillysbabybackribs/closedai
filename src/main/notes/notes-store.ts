import { EventEmitter } from 'node:events'
import { mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { writeAtomic } from '../atomic-write.js'
import { readStoreFile } from '../store-recovery.js'
import {
  NOTE_TITLE_CHARS, derivedNoteTitle, noteLineCount,
  type NoteChange, type NoteDoc, type NoteMeta, type NoteSaveResult
} from '../../shared/notes.js'
import { applyNoteEdit, NoteEditError, type AppliedNoteEdit, type NoteEdit } from './note-edits.js'

// Notes as buffers, not files: typing saves on its own, an untitled note survives a restart, and
// closing a tab never asks to save. Each note's text is its own file beside a small index, so a
// keystroke rewrites one note rather than every note. Same atomic-write + debounce discipline as
// the saved sites store.

type PersistedIndex = { version: 1; notes: Array<Omit<NoteMeta, 'lineCount'>> }

const WRITE_DEBOUNCE_MS = 250
export const MAX_NOTE_CHARS = 2_000_000
const MAX_NOTES = 5000
const ID_PATTERN = /^[0-9a-f-]{36}$/

export class NotesStore extends EventEmitter {
  private readonly notes = new Map<string, NoteDoc>()
  private readonly dirtyText = new Set<string>()
  private readonly removedText = new Set<string>()
  private indexDirty = false
  private writeQueue: Promise<void> = Promise.resolve()
  private writeTimer: ReturnType<typeof setTimeout> | null = null

  private constructor(private readonly dir: string) {
    super()
  }

  static async open(dir: string): Promise<NotesStore> {
    const store = new NotesStore(dir)
    await store.load()
    return store
  }

  /** Most recently changed first. */
  list(): NoteMeta[] {
    return [...this.notes.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(meta)
  }

  read(id: string): NoteDoc | null {
    const note = this.notes.get(id)
    return note ? { ...note } : null
  }

  /** A note by id, or by title: exact (any case) first, then the one title that starts with it. */
  find(reference: string): NoteDoc | null {
    const byId = this.read(reference)
    if (byId) return byId
    const wanted = reference.trim().toLowerCase()
    if (!wanted) return null
    const all = [...this.notes.values()]
    const exact = all.filter((note) => note.title.toLowerCase() === wanted)
    if (exact.length === 1) return { ...exact[0]! }
    const prefixed = all.filter((note) => note.title.toLowerCase().startsWith(wanted))
    return exact.length === 0 && prefixed.length === 1 ? { ...prefixed[0]! } : null
  }

  create(draft: { text?: string; title?: string | null } = {}, origin: NoteChange['origin'] = 'editor', openInChat: string | null = null): NoteDoc {
    if (this.notes.size >= MAX_NOTES) throw new Error(`There are already ${MAX_NOTES} notes; delete some first`)
    const text = clampText(draft.text ?? '')
    const now = Date.now()
    const title = cleanTitle(draft.title)
    const note: NoteDoc = {
      id: randomUUID(), title: title ?? derivedNoteTitle(text), named: title !== null,
      createdAt: now, updatedAt: now, revision: 1, lineCount: noteLineCount(text), text
    }
    this.notes.set(note.id, note)
    this.changed(note, origin, { edited: origin === 'model' && text ? { from: 1, to: note.lineCount } : null, openInChat })
    return { ...note }
  }

  /**
   * The editor's write. It names the revision its buffer was built on; when a model edit landed
   * since, the save is refused and the caller gets the current note to rebase its typing onto.
   */
  save(id: string, text: string, baseRevision: number): NoteSaveResult {
    const note = this.require(id)
    if (note.revision !== baseRevision) return { ok: false, note: { ...note } }
    if (note.text === text) return { ok: true, note: meta(note) }
    this.write(note, clampText(text))
    this.changed(note, 'editor')
    return { ok: true, note: meta(note) }
  }

  /** A model's edit, applied to the current text whatever the editor last saw. */
  edit(id: string, edit: NoteEdit): { note: NoteDoc; applied: AppliedNoteEdit } {
    const note = this.require(id)
    const applied = applyNoteEdit(note.text, edit)
    if (applied.text.length > MAX_NOTE_CHARS) throw new NoteEditError(`The note would exceed ${MAX_NOTE_CHARS} characters`)
    this.write(note, applied.text)
    this.changed(note, 'model', { edited: applied.edited })
    return { note: { ...note }, applied }
  }

  /** Name the note, or pass null to let the title follow the first line again. */
  rename(id: string, title: string | null): NoteMeta {
    const note = this.require(id)
    const clean = cleanTitle(title)
    note.named = clean !== null
    note.title = clean ?? derivedNoteTitle(note.text)
    note.updatedAt = Date.now()
    this.indexDirty = true
    this.changed(note, 'editor', { textChanged: false })
    return meta(note)
  }

  remove(id: string): void {
    const note = this.notes.get(id)
    if (!note) return
    this.notes.delete(id)
    this.dirtyText.delete(id)
    this.removedText.add(id)
    this.indexDirty = true
    this.scheduleWrite()
    this.emit('changed', { note: meta(note), text: null, origin: 'editor' } satisfies NoteChange)
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    const texts = [...this.dirtyText].flatMap((id) => {
      const note = this.notes.get(id)
      return note ? [[id, note.text] as const] : []
    })
    const removed = [...this.removedText]
    const index = this.indexDirty ? JSON.stringify(this.persistedIndex()) : null
    this.dirtyText.clear()
    this.removedText.clear()
    this.indexDirty = false
    this.writeQueue = this.writeQueue.then(async () => {
      for (const [id, text] of texts) await writeAtomic(this.textPath(id), text)
      if (index !== null) await writeAtomic(join(this.dir, 'index.json'), index)
      for (const id of removed) await unlink(this.textPath(id)).catch(() => {})
    }).catch((error: unknown) => { console.warn('[notes] could not write notes:', error) })
    await this.writeQueue
  }

  private write(note: NoteDoc, text: string): void {
    note.text = text
    note.lineCount = noteLineCount(text)
    note.revision += 1
    note.updatedAt = Date.now()
    if (!note.named) note.title = derivedNoteTitle(text)
  }

  private changed(note: NoteDoc, origin: NoteChange['origin'], extra: {
    edited?: NoteChange['edited']; openInChat?: string | null; textChanged?: boolean
  } = {}): void {
    if (extra.textChanged !== false) this.dirtyText.add(note.id)
    this.indexDirty = true
    this.scheduleWrite()
    this.emit('changed', {
      note: meta(note), text: note.text, origin,
      ...(extra.edited ? { edited: extra.edited } : {}),
      ...(extra.openInChat ? { openInChat: extra.openInChat } : {})
    } satisfies NoteChange)
  }

  private require(id: string): NoteDoc {
    const note = this.notes.get(id)
    if (!note) throw new NoteEditError(`There is no note ${id}`)
    return note
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      void this.flush()
    }, WRITE_DEBOUNCE_MS)
  }

  private persistedIndex(): PersistedIndex {
    return { version: 1, notes: [...this.notes.values()].map(({ text: _text, lineCount: _lines, ...rest }) => rest) }
  }

  private textPath(id: string): string {
    return join(this.dir, `${id}.txt`)
  }

  private async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    // The text files are the notes; the index is only their names and times. A damaged index is
    // set aside like any other store, and every note file it no longer lists is adopted back below.
    const index = await readStoreFile(join(this.dir, 'index.json'), '[notes] index', (raw) => {
      const parsed = JSON.parse(raw) as Partial<PersistedIndex>
      if (parsed.version !== 1 || !Array.isArray(parsed.notes)) throw new Error('not a version 1 notes index')
      return parsed as PersistedIndex
    })
    for (const entry of index?.notes ?? []) {
      if (!entry || typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) continue
      const text = await readFile(this.textPath(entry.id), 'utf8').catch(() => null)
      if (text === null) continue
      const named = entry.named === true && typeof entry.title === 'string' && entry.title.trim() !== ''
      this.notes.set(entry.id, {
        id: entry.id,
        title: named ? entry.title.slice(0, NOTE_TITLE_CHARS) : derivedNoteTitle(text),
        named,
        createdAt: finite(entry.createdAt),
        updatedAt: finite(entry.updatedAt),
        revision: Number.isSafeInteger(entry.revision) && entry.revision > 0 ? entry.revision : 1,
        lineCount: noteLineCount(text),
        text
      })
    }
    await this.adoptUnlistedNotes()
  }

  private async adoptUnlistedNotes(): Promise<void> {
    const files = await readdir(this.dir).catch(() => [] as string[])
    for (const file of files) {
      const id = file.endsWith('.txt') ? file.slice(0, -4) : ''
      if (!ID_PATTERN.test(id) || this.notes.has(id) || this.notes.size >= MAX_NOTES) continue
      const path = this.textPath(id)
      const [text, info] = await Promise.all([readFile(path, 'utf8').catch(() => null), stat(path).catch(() => null)])
      if (text === null || !info) continue
      this.notes.set(id, {
        id,
        title: derivedNoteTitle(text),
        named: false,
        createdAt: info.birthtimeMs || info.mtimeMs,
        updatedAt: info.mtimeMs,
        revision: 1,
        lineCount: noteLineCount(text),
        text: text.slice(0, MAX_NOTE_CHARS)
      })
      this.indexDirty = true
    }
    if (this.indexDirty) this.scheduleWrite()
  }
}

function meta({ text: _text, ...rest }: NoteDoc): NoteMeta {
  return rest
}

function cleanTitle(title: unknown): string | null {
  if (typeof title !== 'string') return null
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, NOTE_TITLE_CHARS)
  return clean || null
}

function clampText(text: unknown): string {
  return typeof text === 'string' ? text.slice(0, MAX_NOTE_CHARS) : ''
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
