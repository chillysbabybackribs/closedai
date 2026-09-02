import { memo, type JSX } from 'react'

export const AppWindowControls = memo(function AppWindowControls(): JSX.Element {
  return (
    <div className="shell-window-controls">
      <button
        type="button"
        className="shell-window-control"
        aria-label="Minimize"
        onClick={() => window.closedai.window.minimize()}
      >
        <svg viewBox="0 0 10 10" width="10" height="10">
          <path d="M1.5 5h7" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="shell-window-control"
        aria-label="Maximize"
        onClick={() => window.closedai.window.maximize()}
      >
        <svg viewBox="0 0 10 10" width="10" height="10">
          <rect x="2" y="2" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="0.9" />
        </svg>
      </button>
      <button
        type="button"
        className="shell-window-control shell-window-control-close"
        aria-label="Close"
        onClick={() => window.closedai.window.close()}
      >
        <svg viewBox="0 0 10 10" width="10" height="10">
          <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
})
