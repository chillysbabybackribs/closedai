import type { JSX, ReactNode, SVGProps } from 'react'

/**
 * The ClosedAI glyph family. One 24-unit grid, a 1.5 stroke with round caps, and a `wash`: the same
 * shape filled at 16% so an icon has a body as well as an outline. Everything draws in
 * `currentColor`; the only exception is the Start mark's lit pane, which takes the accent ink.
 * Glyphs are hand-built to read at 16 to 22 px, so keep shapes open and detail to two or three strokes.
 */
export type GlyphProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number }
export type GlyphComponent = (props: GlyphProps) => JSX.Element

const WASH = 0.16

function Base({ size = 20, children, ...rest }: GlyphProps & { children: ReactNode }): JSX.Element {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>{children}</svg>
}

/** A shape drawn twice: the washed body underneath, the outline on top. */
function Body({ d, ...rest }: { d: string } & SVGProps<SVGPathElement>): JSX.Element {
  return <>
    <path d={d} fill="currentColor" fillOpacity={WASH} stroke="none" />
    <path d={d} {...rest} />
  </>
}

export const AgentsGlyph: GlyphComponent = (props) => <Base {...props}>
  <path d="M10.6 7.5 6.9 15.7M13.4 7.5l3.7 8.2M7.9 18.2h8.2" />
  <circle cx="12" cy="5.6" r="2.4" fill="currentColor" fillOpacity={WASH + 0.1} />
  <circle cx="5.7" cy="18.2" r="2.1" />
  <circle cx="18.3" cy="18.2" r="2.1" />
</Base>

export const NoteGlyph: GlyphComponent = (props) => <Base {...props}>
  <Body d="M7.5 3.5H14L19 8.5V18.5a2 2 0 0 1-2 2H7.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" />
  <path d="M14 3.5v4a1 1 0 0 0 1 1h4" />
  <path d="M8.5 13h7M8.5 16.5H13" />
</Base>

export const ToolsGlyph: GlyphComponent = (props) => <Base {...props}>
  <Body d="M5.8 4h3.4A1.8 1.8 0 0 1 11 5.8v3.4A1.8 1.8 0 0 1 9.2 11H5.8A1.8 1.8 0 0 1 4 9.2V5.8A1.8 1.8 0 0 1 5.8 4z" />
  <path d="M5.8 13h3.4a1.8 1.8 0 0 1 1.8 1.8v3.4A1.8 1.8 0 0 1 9.2 20H5.8A1.8 1.8 0 0 1 4 18.2v-3.4A1.8 1.8 0 0 1 5.8 13z" />
  <Body d="M14.8 13h3.4a1.8 1.8 0 0 1 1.8 1.8v3.4a1.8 1.8 0 0 1-1.8 1.8h-3.4a1.8 1.8 0 0 1-1.8-1.8v-3.4a1.8 1.8 0 0 1 1.8-1.8z" />
  <rect x="14.3" y="4.3" width="5.4" height="5.4" rx="1.5" transform="rotate(45 17 7)" />
</Base>

export const HistoryGlyph: GlyphComponent = (props) => <Base {...props}>
  <circle cx="12" cy="12" r="7.8" fill="currentColor" fillOpacity={WASH} stroke="none" />
  <path d="M4.3 12A7.7 7.7 0 1 0 6.6 6.5" />
  <path d="M4.6 3.8v3.7h3.7" />
  <path d="M12 8v4.2l2.8 1.8" />
</Base>

export const DownloadsGlyph: GlyphComponent = (props) => <Base {...props}>
  <Body d="M4.5 15h15v2.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" stroke="none" />
  <path d="M4.5 15v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15" />
  <path d="M12 4v10M8 10.2l4 4 4-4" />
</Base>

export const SavedSitesGlyph: GlyphComponent = (props) => <Base {...props}>
  <Body d="M7.5 4h9A1.5 1.5 0 0 1 18 5.5V20l-6-3.9L6 20V5.5A1.5 1.5 0 0 1 7.5 4z" />
  <path d="M12 7.6l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 9.7l2-.3z" strokeWidth={1.2} />
</Base>

export const TraceGlyph: GlyphComponent = (props) => <Base {...props}>
  <path d="M3.5 12h3.6l2.4-6.5 4.2 13 2.3-6.5h4.5" />
</Base>

export const NewChatGlyph: GlyphComponent = (props) => <Base {...props}>
  <Body d="M12 4.5H7a3 3 0 0 0-3 3V14a3 3 0 0 0 3 3h1v3l3.6-3H15a3 3 0 0 0 3-3v-2" stroke="none" />
  <path d="M12 4.5H7a3 3 0 0 0-3 3V14a3 3 0 0 0 3 3h1v3l3.6-3H15a3 3 0 0 0 3-3v-2" />
  <path d="M18 3.5v6M15 6.5h6" />
</Base>

export const SearchGlyph: GlyphComponent = (props) => <Base {...props}>
  <circle cx="10.5" cy="10.5" r="6" fill="currentColor" fillOpacity={WASH} />
  <path d="M15 15l4.5 4.5" />
</Base>

/** Two sliders: settings as adjustable values, not a gear. */
export const SettingsGlyph: GlyphComponent = (props) => <Base {...props}>
  <path d="M4 8h6.5M17.5 8H20M4 16h2.5M13.5 16H20" />
  <circle cx="14" cy="8" r="2.6" fill="currentColor" fillOpacity={WASH + 0.08} />
  <circle cx="10" cy="16" r="2.6" fill="currentColor" fillOpacity={WASH + 0.08} />
</Base>

/** Windows stacked behind one another: every workspace at once. */
export const WorkspacesGlyph: GlyphComponent = (props) => <Base {...props}>
  <path d="M8.5 7V6A2.5 2.5 0 0 1 11 3.5h7A2.5 2.5 0 0 1 20.5 6v6a2.5 2.5 0 0 1-2.5 2.5h-.5" />
  <Body d="M6 8.5h8.5A2.5 2.5 0 0 1 17 11v6.5a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5V11A2.5 2.5 0 0 1 6 8.5z" />
</Base>

/** The assistant's mark: a four-point star with a small satellite. Used wherever a model is in the loop. */
export const AskGlyph: GlyphComponent = (props) => <Base {...props}>
  <Body d="M10.5 3.5c.7 4.3 2.7 6.3 7 7-4.3.7-6.3 2.7-7 7-.7-4.3-2.7-6.3-7-7 4.3-.7 6.3-2.7 7-7z" />
  <path d="M18.5 15.5v4M16.5 17.5h4" />
</Base>

/** Start: four panes, one lit. The lit pane is the only coloured thing on the footer rail. */
export const StartGlyph: GlyphComponent = ({ size = 20, ...rest }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
  focusable="false" {...rest}>
  <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2.2" fill="currentColor" fillOpacity={0.9} />
  <rect x="3.5" y="13" width="7.5" height="7.5" rx="2.2" fill="currentColor" fillOpacity={0.55} />
  <rect x="13" y="13" width="7.5" height="7.5" rx="2.2" fill="currentColor" fillOpacity={0.55} />
  <rect x="13" y="3.5" width="7.5" height="7.5" rx="2.2" fill="var(--link-ink, #7a88ff)" />
</svg>

export const ChevronGlyph: GlyphComponent = (props) => <Base {...props}>
  <path d="M9.5 6.5 15 12l-5.5 5.5" />
</Base>

/** A chat's state as a Linear-style status circle: running arcs, paused bars, completed checks, open dots, dashed closed. */
export type StatusKind = 'running' | 'paused' | 'completed' | 'open' | 'closed'

export function StatusGlyph({ kind, size = 16, ...rest }: GlyphProps & { kind: StatusKind }): JSX.Element {
  return <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5}
    strokeLinecap="round" aria-hidden="true" focusable="false" data-status={kind} {...rest}>
    {kind === 'running' && <>
      <circle cx="8" cy="8" r="5.75" opacity={0.28} />
      <path d="M8 2.25a5.75 5.75 0 0 1 5.75 5.75" />
      <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </>}
    {kind === 'paused' && <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M6.6 5.9v4.2M9.4 5.9v4.2" />
    </>}
    {kind === 'completed' && <>
      <circle cx="8" cy="8" r="5.75" fill="currentColor" fillOpacity={0.16} />
      <path d="M5.6 8.2l1.7 1.7 3.2-3.5" />
    </>}
    {kind === 'open' && <>
      <circle cx="8" cy="8" r="5.75" />
      <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </>}
    {kind === 'closed' && <circle cx="8" cy="8" r="5.75" strokeDasharray="1.6 2.2" />}
  </svg>
}
