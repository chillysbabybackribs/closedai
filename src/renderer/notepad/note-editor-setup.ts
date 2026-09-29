import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { EditorState, RangeSet, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import {
  Decoration, drawSelection, dropCursor, EditorView, gutterLineClass, GutterMarker, highlightActiveLine,
  highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet
} from '@codemirror/view'
import { tags } from '@lezer/highlight'

// The notepad's editor: a plain-text buffer with line numbers, search, undo and light Markdown
// colour, themed from the app's tokens. Lines a model wrote carry a mark in the gutter and a tint
// until the next task starts, so the user can see what changed without a diff view.

/** Lines (positions in the current doc) a model just wrote. */
export const markEdited = StateEffect.define<Array<{ from: number; to: number }>>()
export const clearEdited = StateEffect.define<null>()

const editedLine = Decoration.line({ class: 'cm-note-edited' })
const editedGutter = new class extends GutterMarker { override elementClass = 'cm-note-edited-gutter' }()

const editedLines = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(clearEdited)) next = Decoration.none
      if (!effect.is(markEdited)) continue
      const doc = transaction.state.doc
      const added: Range<Decoration>[] = []
      for (const range of effect.value) {
        const first = doc.lineAt(Math.min(range.from, doc.length)).number
        const last = doc.lineAt(Math.min(Math.max(range.from, range.to), doc.length)).number
        for (let line = first; line <= last; line += 1) added.push(editedLine.range(doc.line(line).from))
      }
      next = next.update({ add: added, sort: true })
    }
    return next
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    gutterLineClass.from(field, (lines) => {
      const markers: Range<GutterMarker>[] = []
      lines.between(0, Number.MAX_SAFE_INTEGER, (from) => { markers.push(editedGutter.range(from)) })
      return RangeSet.of(markers, true)
    })
  ]
})

const noteHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.3em', fontWeight: '650', color: 'var(--chrome-fg-strong)' },
  { tag: tags.heading2, fontSize: '1.15em', fontWeight: '600', color: 'var(--chrome-fg-strong)' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: '600', color: 'var(--chrome-fg-strong)' },
  { tag: tags.strong, fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--link-ink, var(--tab-accent))', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--link-ink, var(--tab-accent))' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', color: 'var(--ok-ink, #65b98a)' },
  { tag: [tags.processingInstruction, tags.meta, tags.quote], color: 'color-mix(in srgb, var(--chrome-fg) 62%, transparent)' },
  { tag: tags.list, color: 'var(--tab-accent)' }
])

const noteTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--chrome-fg-strong)', backgroundColor: 'transparent', fontSize: 'var(--note-font-size, 13px)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', paddingBottom: '160px' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--tab-accent)' },
  '.cm-line': { padding: '0 16px 0 12px' },
  '.cm-gutters': {
    backgroundColor: 'transparent', color: 'color-mix(in srgb, var(--chrome-fg) 38%, transparent)',
    border: 'none', boxShadow: 'inset -1px 0 0 var(--hairline)'
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px', minWidth: '44px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--chrome-fg) 4%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--chrome-fg)' },
  '.cm-cursor': { borderLeftColor: 'var(--tab-accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--tab-accent) 28%, transparent) !important'
  },
  '.cm-note-edited': { backgroundColor: 'color-mix(in srgb, var(--tab-accent) 9%, transparent)' },
  '.cm-note-edited-gutter': { color: 'var(--tab-accent)', boxShadow: 'inset -2px 0 0 var(--tab-accent)' },
  '.cm-panels': { backgroundColor: 'var(--surface-raised)', color: 'var(--chrome-fg-strong)', borderColor: 'var(--hairline)' },
  '.cm-panel.cm-search': { padding: '6px 10px', fontFamily: 'var(--font-sans, inherit)', fontSize: '12px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontSize: '12px' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warn-ink, #e5c07b) 26%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--tab-accent) 14%, transparent)' }
}, { dark: true })

export function noteEditorExtensions(onChange: Extension): Extension {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    EditorView.lineWrapping,
    markdown(),
    syntaxHighlighting(noteHighlight),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    editedLines,
    noteTheme,
    onChange
  ]
}
