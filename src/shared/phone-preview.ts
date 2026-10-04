// Phone preview: the active web tab shown inside an iPhone 15 frame (portrait). Main places the
// native page surface and the renderer draws the frame behind it; both derive their geometry from
// phonePreviewLayout so the page always lands exactly in the drawn screen.
//
// The native page composites above the DOM, so nothing drawn can overlap it. The status bar and
// home indicator therefore get their own strips of the screen and the page fills what is left,
// the way a real phone reserves its safe areas.

/** iPhone 15 screen in CSS pixels; matches the `iphone-15` emulation preset. */
export const PHONE_SCREEN = { width: 393, height: 852 } as const
export const PHONE_DEVICE_SCALE_FACTOR = 3
export const PHONE_BEZEL = 14
export const PHONE_STATUS_BAR = 54
export const PHONE_HOME_STRIP = 34
export const PHONE_SCREEN_RADIUS = 50
/** Keeps the page's square corners inside the screen's curve above the home strip. */
export const PHONE_PAGE_RADIUS = 12
/** Room kept around the frame inside the browser pane. */
export const PHONE_STAGE_MARGIN = 24

/** The layout viewport the page sees: the screen minus the status bar and home strip. */
export const PHONE_VIEWPORT = {
  width: PHONE_SCREEN.width,
  height: PHONE_SCREEN.height - PHONE_STATUS_BAR - PHONE_HOME_STRIP
} as const

const FRAME_WIDTH = PHONE_SCREEN.width + PHONE_BEZEL * 2
const FRAME_HEIGHT = PHONE_SCREEN.height + PHONE_BEZEL * 2
const MIN_SCALE = 0.25

export type PhoneRect = { x: number; y: number; width: number; height: number }

export type PhonePreviewLayout = {
  /** Fit factor applied to the whole phone; 1 is actual CSS size. */
  scale: number
  /** All rects are relative to the browser pane's top-left corner, in DIP. */
  frame: PhoneRect
  screen: PhoneRect
  /** Where the native page surface goes. Its width over PHONE_VIEWPORT.width is the page scale. */
  page: PhoneRect
  frameRadius: number
  screenRadius: number
  pageRadius: number
}

/** Fit the phone inside the pane, centred; never enlarged past actual size. */
export function phonePreviewLayout(pane: { width: number; height: number }): PhonePreviewLayout {
  const fit = Math.min(
    1,
    (pane.width - PHONE_STAGE_MARGIN * 2) / FRAME_WIDTH,
    (pane.height - PHONE_STAGE_MARGIN * 2) / FRAME_HEIGHT
  )
  const scale = Math.max(MIN_SCALE, fit)
  const frame = {
    x: Math.round((pane.width - FRAME_WIDTH * scale) / 2),
    y: Math.round((pane.height - FRAME_HEIGHT * scale) / 2),
    width: Math.round(FRAME_WIDTH * scale),
    height: Math.round(FRAME_HEIGHT * scale)
  }
  const bezel = Math.round(PHONE_BEZEL * scale)
  const screen = {
    x: frame.x + bezel,
    y: frame.y + bezel,
    width: frame.width - bezel * 2,
    height: frame.height - bezel * 2
  }
  const page = {
    x: screen.x,
    y: screen.y + Math.round(PHONE_STATUS_BAR * scale),
    width: screen.width,
    height: Math.round(PHONE_VIEWPORT.height * scale)
  }
  return {
    scale,
    frame,
    screen,
    page,
    frameRadius: Math.round((PHONE_SCREEN_RADIUS + PHONE_BEZEL) * scale),
    screenRadius: Math.round(PHONE_SCREEN_RADIUS * scale),
    pageRadius: Math.round(PHONE_PAGE_RADIUS * scale)
  }
}

/** Scale the page must render at so its surface shows exactly PHONE_VIEWPORT.width CSS pixels. */
export function phonePageScale(layout: PhonePreviewLayout): number {
  return layout.page.width / PHONE_VIEWPORT.width
}
