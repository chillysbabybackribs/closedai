import type { CSSProperties, ElementType } from 'react'
import { memo, useMemo } from 'react'

import { cn } from '../../lib/utils.js'

export type TextShimmerProps = {
  children: string
  as?: ElementType
  className?: string
  /** Seconds per sweep. */
  duration?: number
  /** Highlight width, in px per character. */
  spread?: number
}

// Port of prompt-kit's TextShimmer without its `motion` dependency: the same
// gradient-over-clipped-text sweep, driven by a CSS keyframe (see prompt-kit-chat.css).
function TextShimmerComponent({ children, as: Component = 'p', className, duration = 2, spread = 2 }: TextShimmerProps) {
  const dynamicSpread = useMemo(() => children.length * spread, [children, spread])
  const style = {
    '--shimmer-spread': `${dynamicSpread}px`,
    '--shimmer-duration': `${duration}s`
  } as CSSProperties
  return (
    <Component data-slot="text-shimmer" className={cn('text-shimmer', className)} style={style}>
      {children}
    </Component>
  )
}

export const TextShimmer = memo(TextShimmerComponent)
