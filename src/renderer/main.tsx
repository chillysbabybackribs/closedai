import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { AppErrorBoundary, watchUnhandledRejections } from './app-error-boundary.js'
import { errorMessage } from './error-message.js'
import { loadAppWindows } from './app-windows/app-window-store.js'

// Prevent a file dropped outside the composer from replacing the entire app.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (event) => event.preventDefault())
}
watchUnhandledRejections((reason) => console.error(`Unhandled rejection: ${errorMessage(reason)}`, reason))

// The first layout must know which window this is and which chats other windows hold.
void loadAppWindows().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode><AppErrorBoundary><App /></AppErrorBoundary></StrictMode>
  )
})
