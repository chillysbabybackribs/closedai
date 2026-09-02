import type { JSX } from 'react'
import { GripVerticalIcon } from 'lucide-react'
import * as ResizablePrimitive from 'react-resizable-panels'

import { cn } from '../../lib/utils.js'

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps): JSX.Element {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn('resizable-panel-group', className)}
      {...props}
    />
  )
}

function ResizablePanel(props: ResizablePrimitive.PanelProps): JSX.Element {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}): JSX.Element {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn('resizable-handle', className)}
      {...props}
    >
      {withHandle ? (
        <span data-slot="resizable-handle-grip" aria-hidden="true">
          <GripVerticalIcon />
        </span>
      ) : null}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
