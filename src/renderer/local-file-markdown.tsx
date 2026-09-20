import { useMemo, useState } from 'react'
import type { Components } from 'react-markdown'
import { Markdown, MarkdownLink } from '../components/ui/markdown.js'
import { localFilePath } from '../shared/local-files.js'
import { ImagePreviewDialog, type ImagePreviewTarget } from './attachment-preview.js'

function LocalFileLink({ href, children }: { href: string; children?: React.ReactNode }) {
  const [target, setTarget] = useState<ImagePreviewTarget | null>(null)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  async function open() {
    setOpening(true)
    setError('')
    try {
      const result = await window.closedai.localFiles.open(href)
      if (result.kind === 'image') setTarget(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open this file.')
    } finally { setOpening(false) }
  }
  return <>
    <button type="button" className="aui-md-local-file" data-ui="chat.local-file" data-ui-key={href}
      title={localFilePath(href) ?? href} disabled={opening} onClick={() => void open()}>{children}</button>
    {error && <span className="aui-md-file-error" role="alert">{error}</span>}
    <ImagePreviewDialog target={target} onClose={() => setTarget(null)} />
  </>
}

export function LocalFileMarkdown({ children }: { children: string }) {
  const components = useMemo<Partial<Components>>(() => ({
    a: function FileOrWebLink(props) {
      return localFilePath(props.href)
        ? <LocalFileLink href={props.href!}>{props.children}</LocalFileLink>
        : <MarkdownLink {...props} />
    }
  }), [])
  return <Markdown components={components}>{children}</Markdown>
}
