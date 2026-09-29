import * as React from 'react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'

import { cn } from '../../lib/utils.js'

/* shadcn new-york dropdown-menu, restyled monochrome for the dark chrome: a surface one step
   above the tile header, a hairline edge, grey glyphs that brighten on the highlighted row. */

function DropdownMenu(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger(props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({ className, sideOffset = 6, collisionPadding = 8, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'dropdown-menu-content z-[60] min-w-[200px] overflow-hidden rounded-lg p-1',
          'border border-[var(--menu-edge)] bg-[var(--menu-surface)] text-[var(--menu-ink)]',
          'shadow-[0_0_0_1px_rgb(0_0_0/40%),0_12px_32px_rgb(0_0_0/55%)] outline-none',
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup(props: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

const menuItemClasses = cn(
  'relative flex h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2 text-[13px] leading-none outline-none',
  '[&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:text-[var(--menu-glyph)]',
  'data-[highlighted]:bg-[var(--menu-highlight)] data-[highlighted]:text-[var(--menu-ink-strong)]',
  'data-[highlighted]:[&_svg]:text-[var(--menu-ink-strong)]',
  'data-[disabled]:pointer-events-none data-[disabled]:text-[var(--menu-quiet)]',
)

function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        menuItemClasses,
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub(props: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub {...props} />
}

function DropdownMenuSubTrigger({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return <DropdownMenuPrimitive.SubTrigger
    data-slot="dropdown-menu-sub-trigger" className={cn(menuItemClasses, className)} {...props} />
}

function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.SubContent data-slot="dropdown-menu-sub-content"
      collisionPadding={8}
      className={cn(
        'dropdown-menu-content z-[60] min-w-[200px] overflow-hidden rounded-lg p-1',
        'border border-[var(--menu-edge)] bg-[var(--menu-surface)] text-[var(--menu-ink)]',
        'shadow-[0_0_0_1px_rgb(0_0_0/40%),0_12px_32px_rgb(0_0_0/55%)] outline-none',
        className
      )} {...props} />
  </DropdownMenuPrimitive.Portal>
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn('truncate px-2 pb-1 pt-1.5 text-[11px] font-medium text-[var(--menu-quiet)]', className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-[var(--menu-edge)]', className)}
      {...props}
    />
  )
}

/** Trailing quiet text on an item: a shortcut or a one-word live fact. */
function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn('ml-auto pl-4 text-[11px] text-[var(--menu-quiet)] whitespace-nowrap', className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent
}
