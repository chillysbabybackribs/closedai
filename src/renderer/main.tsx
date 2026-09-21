import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { AppErrorBoundary, watchUnhandledRejections } from './app-error-boundary.js'
import { errorMessage } from './error-message.js'

// Prevent a file dropped outside the composer from replacing the entire app.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (event) => event.preventDefault())
}
watchUnhandledRejections((reason) => console.error(`Unhandled rejection: ${errorMessage(reason)}`, reason))

createRoot(document.getElementById('root')!).render(
  <StrictMode><AppErrorBoundary><App /></AppErrorBoundary></StrictMode>
)
