import { useEffect, useState, type RefObject } from 'react'
import { PHONE_HOME_STRIP, PHONE_SCREEN, PHONE_STATUS_BAR, phonePreviewLayout } from '../shared/phone-preview.js'

/**
 * The iPhone drawn behind a phone-preview page. Main places the native page surface from the same
 * phonePreviewLayout of the same host box, so the page lands exactly in this screen; the status
 * bar and home indicator sit in the strips above and below it because nothing drawn here can
 * overlap the native page. The freeze still, when the page is parked under an overlay, goes where
 * the page surface was.
 */
export function BrowserPhoneFrame({ hostRef, freezeUrl }: { hostRef: RefObject<HTMLDivElement | null>; freezeUrl?: string | null }) {
  const size = useBoxSize(hostRef)
  const time = useClockMinute()
  if (!size) return null
  const layout = phonePreviewLayout(size)
  const { frame, screen, page, scale } = layout
  const strip = (height: number) => ({ width: PHONE_SCREEN.width, height, transform: `scale(${scale})` })
  return (
    <div
      className="phone-frame"
      aria-hidden="true"
      style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height, borderRadius: layout.frameRadius }}
    >
      <span className="phone-frame-button is-action" />
      <span className="phone-frame-button is-volume-up" />
      <span className="phone-frame-button is-volume-down" />
      <span className="phone-frame-button is-power" />
      <div
        className="phone-frame-screen"
        style={{ left: screen.x - frame.x, top: screen.y - frame.y, width: screen.width, height: screen.height, borderRadius: layout.screenRadius }}
      >
        <div className="phone-frame-status" style={strip(PHONE_STATUS_BAR)}>
          <span className="phone-frame-time">{time}</span>
          <span className="phone-frame-island" />
          <span className="phone-frame-indicators">
            <SignalGlyph />
            <WifiGlyph />
            <BatteryGlyph />
          </span>
        </div>
        {freezeUrl ? (
          <img
            className="phone-frame-freeze"
            src={freezeUrl}
            alt=""
            style={{ left: page.x - screen.x, top: page.y - screen.y, width: page.width, height: page.height, borderRadius: layout.pageRadius }}
          />
        ) : null}
        <div className="phone-frame-home" style={{ ...strip(PHONE_HOME_STRIP), top: page.y - screen.y + page.height }}>
          <span className="phone-frame-home-indicator" />
        </div>
      </div>
    </div>
  )
}

function useBoxSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      // Rounded like the bounds main receives from the same box (BrowserTab sanitizeBounds).
      const rect = element.getBoundingClientRect()
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) }
      setSize((current) => (current?.width === next.width && current.height === next.height ? current : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

function useClockMinute(): string {
  const format = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '')
  const [time, setTime] = useState(format)
  useEffect(() => {
    const timer = window.setInterval(() => setTime(format()), 15_000)
    return () => window.clearInterval(timer)
  }, [])
  return time
}

function SignalGlyph() {
  return (
    <svg viewBox="0 0 18 12" width="18" height="12" fill="currentColor">
      <rect x="0" y="8" width="3" height="4" rx="1" />
      <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
      <rect x="10" y="3" width="3" height="9" rx="1" />
      <rect x="15" y="0" width="3" height="12" rx="1" />
    </svg>
  )
}

function WifiGlyph() {
  return (
    <svg viewBox="0 0 16 12" width="16" height="12" fill="currentColor">
      <path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.1-1.2A10.2 10.2 0 0 0 8 .6 10.2 10.2 0 0 0 .9 3.4L2 4.6a8.6 8.6 0 0 1 6-2.4Z" />
      <path d="M8 5.6c1.4 0 2.6.5 3.6 1.4l1.1-1.2A7 7 0 0 0 8 4a7 7 0 0 0-4.7 1.8L4.4 7c1-.9 2.2-1.4 3.6-1.4Z" />
      <path d="M8 8.9c.6 0 1.1.2 1.5.6L8 11.2 6.5 9.5c.4-.4.9-.6 1.5-.6Z" />
    </svg>
  )
}

function BatteryGlyph() {
  return (
    <svg viewBox="0 0 27 12" width="27" height="12">
      <rect x="0.5" y="0.5" width="22" height="11" rx="3.5" fill="none" stroke="currentColor" opacity="0.4" />
      <rect x="2" y="2" width="17" height="8" rx="2" fill="currentColor" />
      <rect x="24" y="4" width="2" height="4" rx="1" fill="currentColor" opacity="0.4" />
    </svg>
  )
}
