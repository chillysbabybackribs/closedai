import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type JSX } from 'react'
import { useInView, useMotionValue, useReducedMotion, useSpring } from 'motion/react'

import { cn } from '../../lib/utils.js'

// Magic UI number-ticker (@magicui/number-ticker), adapted: it starts at the value it mounts with
// instead of counting up from zero, so a settled transcript row paints its number at once and only
// later changes roll, and it jumps straight to each value when the user prefers reduced motion.

type NumberTickerProps = Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
  value: number
  /** What to show on mount before rolling to `value`; defaults to `value` itself. */
  startValue?: number
}

export function NumberTicker({ value, startValue, className, ...props }: NumberTickerProps): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const [initial] = useState(() => startValue ?? value)
  const motionValue = useMotionValue(initial)
  const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 })
  const inView = useInView(ref, { once: true, margin: '0px' })
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (reduceMotion) {
      if (ref.current) ref.current.textContent = format(value)
      return
    }
    if (inView) motionValue.set(value)
  }, [motionValue, inView, value, reduceMotion])

  useEffect(() => springValue.on('change', (latest) => {
    if (ref.current) ref.current.textContent = format(latest)
  }), [springValue])

  return (
    <span ref={ref} className={cn('inline-block tabular-nums', className)} {...props}>
      {format(initial)}
    </span>
  )
}

function format(value: number): string {
  return Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value))
}
