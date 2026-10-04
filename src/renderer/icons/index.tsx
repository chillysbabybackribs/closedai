import { forwardRef, type ForwardRefExoticComponent, type RefAttributes, type SVGProps } from 'react'
import { F7_GLYPHS } from './f7-glyphs.js'

/**
 * The app's line icons: Framework7 Icons (MIT), an SF Symbols-style set, exported under the
 * Lucide names the call sites already use, so `size`, `className`, `aria-*` and `fill` keep
 * working. Glyphs are filled shapes, so `strokeWidth` is accepted and ignored. Passing a
 * non-`none` `fill` selects the solid variant where one exists (a saved star, a pinned pin).
 * Framework7 draws inside a padded 56-unit box; the 3-unit inset viewBox matches Lucide's
 * optical size, so swapping sets keeps layout boxes identical.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & {
  size?: number | string
  strokeWidth?: number | string
  absoluteStrokeWidth?: boolean
}
export type IconComponent = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>

const VIEW_BOX = '3 3 50 50'

function f7Icon(displayName: string, glyph: string, solidGlyph?: string): IconComponent {
  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
    { size = 24, strokeWidth: _strokeWidth, absoluteStrokeWidth: _absolute, fill, className, ...rest },
    ref
  ) {
    const solid = solidGlyph && fill && fill !== 'none'
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox={VIEW_BOX}
        fill="currentColor"
        className={className ? `icon ${className}` : 'icon'}
        {...rest}
        dangerouslySetInnerHTML={{ __html: F7_GLYPHS[solid ? solidGlyph : glyph] }}
      />
    )
  })
  Icon.displayName = displayName
  return Icon
}

/** Framework7 has no activity indicator; this is a three-quarter arc in the same box for `.spin`. */
const Spinner: IconComponent = forwardRef<SVGSVGElement, IconProps>(function Spinner(
  { size = 24, strokeWidth: _strokeWidth, absoluteStrokeWidth: _absolute, fill: _fill, className, ...rest },
  ref
) {
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox={VIEW_BOX} fill="none"
      className={className ? `icon ${className}` : 'icon'} {...rest}>
      <path d="M28 8.5a19.5 19.5 0 1 1-19.5 19.5" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  )
})
Spinner.displayName = 'Spinner'

export const AlertCircle = f7Icon('AlertCircle', 'exclamationmark-circle')
export const AppWindow = f7Icon('AppWindow', 'macwindow')
export const Archive = f7Icon('Archive', 'archivebox')
export const ArrowDownIcon = f7Icon('ArrowDownIcon', 'arrow-down')
export const ArrowLeft = f7Icon('ArrowLeft', 'chevron-left')
export const ArrowLeftToLine = f7Icon('ArrowLeftToLine', 'arrow-left-to-line')
export const ArrowRight = f7Icon('ArrowRight', 'chevron-right')
export const ArrowRightToLine = f7Icon('ArrowRightToLine', 'arrow-right-to-line')
export const ArrowUp = f7Icon('ArrowUp', 'arrow-up')
export const ArrowUpRight = f7Icon('ArrowUpRight', 'arrow-up-right')
export const Camera = f7Icon('Camera', 'camera')
export const Check = f7Icon('Check', 'checkmark')
export const CheckCircle2 = f7Icon('CheckCircle2', 'checkmark-circle')
export const ChevronDown = f7Icon('ChevronDown', 'chevron-down')
export const ChevronRight = f7Icon('ChevronRight', 'chevron-right')
export const ChevronUp = f7Icon('ChevronUp', 'chevron-up')
export const ChevronsDownUp = f7Icon('ChevronsDownUp', 'rectangle-compress-vertical')
export const CircleAlert = f7Icon('CircleAlert', 'exclamationmark-circle')
export const CircleEllipsis = f7Icon('CircleEllipsis', 'ellipsis-circle')
export const CircleSlash = f7Icon('CircleSlash', 'slash-circle')
export const ClipboardPaste = f7Icon('ClipboardPaste', 'doc-on-clipboard')
export const CodeXml = f7Icon('CodeXml', 'chevron-left-slash-chevron-right')
export const Columns2 = f7Icon('Columns2', 'square-split-2x1')
export const Copy = f7Icon('Copy', 'doc-on-doc')
export const Cpu = f7Icon('Cpu', 'speedometer')
export const Download = f7Icon('Download', 'arrow-down-circle')
export const Edit3 = f7Icon('Edit3', 'pencil')
export const Ellipsis = f7Icon('Ellipsis', 'ellipsis')
export const ExternalLink = f7Icon('ExternalLink', 'arrow-up-right-square')
export const Eye = f7Icon('Eye', 'eye', 'eye-fill')
export const EyeOff = f7Icon('EyeOff', 'eye-slash')
export const FileCode = f7Icon('FileCode', 'doc-plaintext')
export const FileImage = f7Icon('FileImage', 'photo')
export const FilePenLine = f7Icon('FilePenLine', 'square-pencil')
export const FilePlus2 = f7Icon('FilePlus2', 'doc-append')
export const FileText = f7Icon('FileText', 'doc-text')
export const FileVideo = f7Icon('FileVideo', 'film')
export const Film = f7Icon('Film', 'film')
export const Folder = f7Icon('Folder', 'folder', 'folder-fill')
export const FolderOpen = f7Icon('FolderOpen', 'folder')
export const Globe = f7Icon('Globe', 'globe')
export const Globe2 = f7Icon('Globe2', 'globe')
export const Image = f7Icon('Image', 'photo')
export const ImageIcon = f7Icon('ImageIcon', 'photo')
export const KeyRound = f7Icon('KeyRound', 'lock-shield')
export const Layers = f7Icon('Layers', 'layers')
export const LayoutGrid = f7Icon('LayoutGrid', 'square-grid-2x2')
export const Link2 = f7Icon('Link2', 'link')
export const Lock = f7Icon('Lock', 'lock-fill', 'lock-fill')
export const LogIn = f7Icon('LogIn', 'square-arrow-right')
export const Maximize = f7Icon('Maximize', 'arrow-up-left-arrow-down-right')
export const Maximize2 = f7Icon('Maximize2', 'arrow-up-left-arrow-down-right')
export const MessageSquare = f7Icon('MessageSquare', 'bubble-left')
export const MessageSquareDashed = f7Icon('MessageSquareDashed', 'bubble-middle-bottom')
export const MessageSquareMore = f7Icon('MessageSquareMore', 'chat-bubble-text')
export const MessageSquareShare = f7Icon('MessageSquareShare', 'arrowshape-turn-up-right')
export const MessageSquareText = f7Icon('MessageSquareText', 'text-bubble')
export const Minimize2 = f7Icon('Minimize2', 'arrow-down-right-arrow-up-left')
export const Minus = f7Icon('Minus', 'minus')
export const PanelLeftClose = f7Icon('PanelLeftClose', 'sidebar-left')
export const PanelRightOpen = f7Icon('PanelRightOpen', 'sidebar-right')
export const Paperclip = f7Icon('Paperclip', 'paperclip')
export const Pause = f7Icon('Pause', 'pause-fill')
export const Pencil = f7Icon('Pencil', 'pencil')
export const Pin = f7Icon('Pin', 'pin', 'pin-fill')
export const PinOff = f7Icon('PinOff', 'pin-slash')
export const Play = f7Icon('Play', 'play-fill')
export const Plus = f7Icon('Plus', 'plus')
export const RefreshCw = f7Icon('RefreshCw', 'arrow-clockwise')
export const Repeat = f7Icon('Repeat', 'repeat')
export const RotateCcw = f7Icon('RotateCcw', 'arrow-counterclockwise')
export const Rows2 = f7Icon('Rows2', 'square-split-1x2')
export const Scan = f7Icon('Scan', 'viewfinder')
export const Search = f7Icon('Search', 'search')
export const SearchX = f7Icon('SearchX', 'search')
export const ShieldAlert = f7Icon('ShieldAlert', 'exclamationmark-shield')
export const ShieldCheck = f7Icon('ShieldCheck', 'checkmark-shield')
export const Shuffle = f7Icon('Shuffle', 'shuffle')
export const SkipBack = f7Icon('SkipBack', 'backward-end-fill')
export const SkipForward = f7Icon('SkipForward', 'forward-end-fill')
export const Smartphone = f7Icon('Smartphone', 'device-phone-portrait')
export const Sparkles = f7Icon('Sparkles', 'sparkles')
export const Square = f7Icon('Square', 'square', 'square-fill')
export const SquareArrowDownLeft = f7Icon('SquareArrowDownLeft', 'arrow-down-left-square')
export const SquareArrowOutUpRight = f7Icon('SquareArrowOutUpRight', 'arrow-up-right-square')
export const SquareTerminal = f7Icon('SquareTerminal', 'command')
export const Star = f7Icon('Star', 'star', 'star-fill')
export const Trash2 = f7Icon('Trash2', 'trash')
export const Type = f7Icon('Type', 'textformat')
export const Upload = f7Icon('Upload', 'square-arrow-up')
export const UserPlus = f7Icon('UserPlus', 'person-badge-plus')
export const UserRound = f7Icon('UserRound', 'person-crop-circle')
export const Users = f7Icon('Users', 'person-2')
export const Volume2 = f7Icon('Volume2', 'speaker-2')
export const VolumeX = f7Icon('VolumeX', 'speaker-slash')
export const Wrench = f7Icon('Wrench', 'wrench')
export const X = f7Icon('X', 'xmark')
export const XCircle = f7Icon('XCircle', 'xmark-circle')
export const ZoomIn = f7Icon('ZoomIn', 'zoom-in')
export const ZoomOut = f7Icon('ZoomOut', 'zoom-out')
export const Loader2 = Spinner
export const LoaderCircle = Spinner
