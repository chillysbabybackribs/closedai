import type { HTMLAttributes, ReactNode } from 'react'
import { StickToBottom } from 'use-stick-to-bottom'

import { cn } from '../../lib/utils.js'

type ChatContainerProps = HTMLAttributes<HTMLDivElement> & { children: ReactNode }

function ChatContainerRoot({ className, children, ...props }: ChatContainerProps) {
  return (
    <StickToBottom
      data-slot="chat-container"
      className={cn('flex overflow-y-auto', className)}
      resize="smooth"
      initial="instant"
      role="log"
      {...props}
    >
      {children}
    </StickToBottom>
  )
}

function ChatContainerContent({ className, children, ...props }: ChatContainerProps) {
  return <StickToBottom.Content className={cn('flex w-full flex-col', className)} {...props}>{children}</StickToBottom.Content>
}

function ChatContainerScrollAnchor({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('h-px w-full shrink-0 scroll-mt-4', className)} aria-hidden="true" {...props} />
}

export { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor }
