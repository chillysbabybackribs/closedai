import { cn } from '../../lib/utils.js'

export type LoaderProps = {
  variant?: 'circular' | 'dots' | 'typing' | 'pulse-dot'
  size?: 'sm' | 'md' | 'lg'
  text?: string
  className?: string
}

function Loader({ variant = 'circular', size = 'md', text, className }: LoaderProps) {
  const sizeClass = size === 'sm' ? 'size-3.5' : size === 'lg' ? 'size-6' : 'size-5'
  if (variant === 'dots' || variant === 'typing') {
    return (
      <span data-slot="loader" className={cn('prompt-loader-dots', className)} role="status" aria-label={text ?? 'Working'}>
        <i /><i /><i />{text && <span>{text}</span>}
      </span>
    )
  }
  if (variant === 'pulse-dot') {
    return <span data-slot="loader" className={cn('prompt-loader-pulse', sizeClass, className)} role="status" aria-label={text ?? 'Working'} />
  }
  return <span data-slot="loader" className={cn('prompt-loader-spinner', sizeClass, className)} role="status" aria-label={text ?? 'Working'} />
}

export { Loader }
