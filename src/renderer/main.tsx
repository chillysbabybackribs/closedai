import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'

// Prevent a file dropped outside the composer from replacing the entire app.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (event) => event.preventDefault())
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
