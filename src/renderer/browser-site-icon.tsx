import { useState } from 'react'
import { Globe2 } from 'lucide-react'

/** Remember which image failed so a new icon can load without an effect/reset flash. */
export function BrowserSiteIcon({ favicon }: { favicon?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!favicon || failed === favicon) return <Globe2 size={17} aria-hidden="true" />
  return (
    <img
      className="browser-suggestion-favicon"
      src={favicon}
      alt=""
      aria-hidden="true"
      referrerPolicy="no-referrer"
      onError={() => setFailed(favicon)}
    />
  )
}
