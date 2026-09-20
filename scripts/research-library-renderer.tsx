import { createRoot } from 'react-dom/client'
import { ResearchLibraryDialog } from '../src/renderer/research/library-dialog.js'
import '../src/renderer/styles.css'

createRoot(document.getElementById('root')!).render(<ResearchLibraryDialog open onOpenChange={() => {}} />)
