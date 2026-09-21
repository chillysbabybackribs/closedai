import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react'

import { errorMessage } from './error-message.js'

export type AppErrorBoundaryProps = {
  children: ReactNode
  /** Replaces the default panel; receives the message the user should read. */
  fallback?: (message: string) => ReactNode
  onError?: (error: Error, info: ErrorInfo) => void
}

/**
 * The last line between a render-time exception and a blank window. React unmounts the whole
 * tree under an uncaught render error; this keeps a panel with the reason and a way back
 * (Reload restarts the renderer only, so main and the chat providers keep their state).
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, { message: string | null }> {
  state = { message: null }

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: errorMessage(error, 'The window failed to render') }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info)
  }

  render(): ReactNode {
    const { message } = this.state
    if (message === null) return this.props.children
    return this.props.fallback ? this.props.fallback(message) : <AppErrorPanel message={message} />
  }
}

/** The default panel: what went wrong, and Reload. */
export function AppErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div className="shell-startup" role="alert" data-ui-surface="shell-error">
      <h1>Something went wrong</h1>
      <p>{message}</p>
      <button type="button" className="shell-startup-action" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  )
}

/**
 * Report promise rejections nothing awaited; returns the unsubscribe. The preview turns them
 * into its readiness failure, the app into a console line that names the reason.
 */
export function watchUnhandledRejections(report: (reason: unknown) => void): () => void {
  const onRejection = (event: PromiseRejectionEvent): void => report(event.reason)
  window.addEventListener('unhandledrejection', onRejection)
  return () => window.removeEventListener('unhandledrejection', onRejection)
}
