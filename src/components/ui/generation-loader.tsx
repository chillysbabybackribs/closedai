import type { ComponentProps, JSX } from 'react'
import { useEffect, useState } from 'react'

import { cn } from '../../lib/utils.js'

export type GenerationLoaderVariant = 'dots' | 'squares' | 'rounded'

export type GenerationLoaderProps = Omit<ComponentProps<'div'>, 'children'> & {
  label: string
  tick: number
  variant?: GenerationLoaderVariant
}

const CELL_SHAPES: Record<GenerationLoaderVariant, string> = {
  dots: 'rounded-full',
  squares: 'rounded-[1px]',
  rounded: 'rounded-[3px]'
}

/** Horizontal adaptation of assistant-ui's pixel-matrix generation loader. */
export function GenerationLoader({
  label,
  tick,
  variant = 'rounded',
  className,
  ...props
}: GenerationLoaderProps): JSX.Element {
  const typedLabel = useTypewriter(label)
  const pixelOffset = Math.floor(tick / 3)

  return (
    <div
      data-slot="generation-loader"
      className={cn('task-generation-loader', className)}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      {...props}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="task-generation-grid">
        {Array.from({ length: 9 }, (_, index) => {
          const active = (index * 2 + pixelOffset) % 9 < 3
          return (
            <span
              key={index}
              className={cn('task-generation-cell', CELL_SHAPES[variant])}
              data-active={active || undefined}
            />
          )
        })}
      </span>
      <span className="task-generation-copy" aria-hidden="true">
        {typedLabel}
        <span className="task-generation-caret" data-typing={typedLabel.length < label.length || undefined} />
      </span>
    </div>
  )
}

function useTypewriter(label: string): string {
  const [visible, setVisible] = useState('')
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => setReduceMotion(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (reduceMotion) {
      setVisible(label)
      return
    }
    setVisible('')
    let index = 0
    const id = window.setInterval(() => {
      index += 1
      setVisible(label.slice(0, index))
      if (index >= label.length) window.clearInterval(id)
    }, 28)
    return () => window.clearInterval(id)
  }, [label, reduceMotion])

  return visible
}
