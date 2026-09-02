import type { JSX } from 'react'
import { ArrowLeft, RefreshCw, ShieldAlert } from 'lucide-react'
import type { BrowserNavigationError as NavigationError } from '../shared/types.js'
import { Button } from '../components/ui/button.js'

function hostLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).host.replace(/^www\./, '') || rawUrl
  } catch {
    return rawUrl
  }
}

export function BrowserNavigationError({
  error,
  onRetry,
  onReturn
}: {
  error: NavigationError
  onRetry: () => void
  onReturn: () => void
}): JSX.Element {
  const canReturn = Boolean(error.previousUrl && error.previousUrl !== error.url)
  const diagnostic = error.errno === null ? error.code : `${error.code} (${error.errno})`

  return (
    <section
      className="browser-navigation-error"
      role="alert"
      aria-live="assertive"
      aria-label="Page load error"
      data-ui-source="src/renderer/browser-navigation-error.tsx#BrowserNavigationError"
      data-ui-state-owner="src/renderer/browser-controller.ts#useBrowserController"
    >
      <div className="browser-navigation-error-content">
        <ShieldAlert className="browser-navigation-error-icon" aria-hidden="true" />
        <p className="browser-navigation-error-eyebrow">Page load failed</p>
        <h2>{error.title}</h2>
        <p className="browser-navigation-error-summary">{error.summary}</p>
        <p className="browser-navigation-error-url" title={error.url}>{error.url}</p>
        {error.suggestions.length ? (
          <div className="browser-navigation-error-help">
            <p>Try:</p>
            <ul>
              {error.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}
            </ul>
          </div>
        ) : null}
        <p className="browser-navigation-error-code">{diagnostic}</p>
        <div className="browser-navigation-error-actions">
          <Button type="button" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            Retry
          </Button>
          {canReturn ? (
            <Button type="button" size="sm" variant="outline" onClick={onReturn}>
              <ArrowLeft aria-hidden="true" />
              Back to {hostLabel(error.previousUrl)}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
