import { useMemo, useState } from 'react'
import type { Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { cn } from '../lib/utils.js'
import { Markdown, MarkdownLink } from '../components/ui/markdown.js'
import { remarkBareUrls } from '../components/ui/markdown-links.js'
import { remarkWorkspaceFilePaths } from '../components/ui/markdown-workspace-paths.js'
import { isWorkspaceFileHref, localFilePath } from '../shared/local-files.js'

const CHAT_REMARK_PLUGINS = [remarkGfm, remarkBreaks, remarkBareUrls, remarkWorkspaceFilePaths]

function LocalFileLink({ href, cwd, children }: { href: string; cwd?: string; children?: React.ReactNode }) {
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  async function open() {
    setOpening(true)
    setError('')
    try {
      await window.closedai.localFiles.open(href, cwd ? { cwd } : undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open this file.')
    } finally { setOpening(false) }
  }
  return <>
    <button type="button" className="aui-md-local-file" data-ui="chat.local-file" data-ui-key={href}
      title={localFilePath(href) ?? href} disabled={opening} onClick={() => void open()}>{children}</button>
    {error && <span className="aui-md-file-error" role="alert">{error}</span>}
  </>
}

export function LocalFileMarkdown({ children, streaming, cwd }: { children: string; streaming?: boolean; cwd?: string }) {
  const components = useMemo<Partial<Components>>(() => ({
    a: function FileOrWebLink(props) {
      return isWorkspaceFileHref(props.href)
        ? <LocalFileLink href={props.href!} cwd={cwd}>{props.children}</LocalFileLink>
        : <MarkdownLink {...props} />
    },
    code: function FilePathCode({ className, children, node: _node, ...props }) {
      const code = String(children).replace(/\n$/, '')
      const multiline = code.includes('\n') || className?.includes('language-')
      if (!multiline) {
        const path = code.trim()
        if (isWorkspaceFileHref(path)) {
          return <LocalFileLink href={path} cwd={cwd}>{code}</LocalFileLink>
        }
        return <code className={cn('aui-md-inline-code', className)} {...props}>{children}</code>
      }
      return <code className={cn('aui-md-inline-code', className)} {...props}>{children}</code>
    }
  }), [cwd])
  return <Markdown components={components} remarkPlugins={CHAT_REMARK_PLUGINS} streaming={streaming}>{children}</Markdown>
}
