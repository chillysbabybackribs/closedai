import type { ComponentProps, JSX, ReactNode } from "react"
import {
  Bookmark,
  Calendar,
  Cog,
  Compass,
  Home,
  Image as ImageIcon,
  Search,
  Telescope,
  type LucideIcon,
} from "lucide-react"

import { cn } from "../../lib/utils.js"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip.js"

// A glass icon dock: a pill bar of raised square tiles that lift on hover, name themselves in a
// tooltip, and carry an optional count badge. Colours come from theme tokens so the bar follows
// the active theme. Labels use the shared Tooltip, which is portaled (never clipped at a window
// edge) and which the native browser view already yields to. HeroDockBar, HeroDockIcon and
// HeroDockSeparator are the reusable pieces; the default export is the hero they were published with.

export default function HeroDock(): JSX.Element {
  return (
    <div className="relative min-h-screen w-full bg-black">
      {/* Black background with a top glow */}
      <div
        className="absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(120, 180, 255, 0.25), transparent 70%), #000000",
        }}
      />

      <section className="relative isolate min-h-screen w-full overflow-hidden px-4 text-white sm:px-8">
        {/* Vignette edges */}
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 [mask-image:radial-gradient(90%_70%_at_50%_45%,black,transparent_85%)] sm:[mask-image:radial-gradient(80%_60%_at_50%_40%,black,transparent_80%)]" />
          <div className="absolute inset-y-0 left-0 w-24 animate-[hero-dock-marquee-left_8s_linear_infinite_alternate] opacity-40 blur-xl [background:linear-gradient(90deg,rgba(255,255,255,0.25),transparent)] sm:w-40 sm:opacity-60 sm:blur-2xl" />
          <div className="absolute inset-y-0 right-0 w-24 animate-[hero-dock-marquee-right_8s_linear_infinite_alternate] opacity-40 blur-xl [background:linear-gradient(270deg,rgba(255,255,255,0.25),transparent)] sm:w-40 sm:opacity-60 sm:blur-2xl" />
        </div>

        {/* Subtle noise */}
        <div className="pointer-events-none absolute inset-0 -z-20 opacity-[0.05] [background-image:radial-gradient(rgba(255,255,255,0.2)_1px,transparent_1px)] [background-size:12px_12px]" />

        <div
          className="mx-auto flex h-full max-w-5xl flex-col items-center justify-start gap-4 text-center sm:gap-8"
          style={{ marginTop: "20%" }}
        >
          <h1 className="text-balance font-semibold tracking-tight text-white/90 [font-size:clamp(20px,4.5vw,38px)]">
            The Dali Agents console
          </h1>
          <p className="mx-auto max-w-xl text-pretty text-xs text-white/70 sm:text-sm">
            One dock for every agent surface. AI agents that work - or you don't pay.
          </p>

          <div className="relative mt-6 w-full max-w-[85%] sm:max-w-[80%]">
            <div className="flex items-center justify-center">
              <HeroDockBar className="scale-90 sm:scale-95">
                <HeroDockIcon icon={Home} label="Agents" />
                <HeroDockIcon icon={Compass} label="Leads" />
                <HeroDockIcon icon={Calendar} label="Operations" badge="4" />
                <HeroDockIcon icon={Bookmark} label="Support" />
                <HeroDockIcon icon={ImageIcon} label="Care" />
                <HeroDockIcon icon={Telescope} label="Rescue" />
                <HeroDockSeparator />
                <HeroDockIcon icon={Search} label="Search" />
                <HeroDockIcon icon={Cog} label="Settings" />
              </HeroDockBar>
            </div>
            <div className="mt-4 flex justify-center">
              <a
                href="https://daliagents.com"
                target="_blank"
                rel="noreferrer"
                className="text-[10px] tracking-wide text-white/40 transition-colors hover:text-white/70"
              >
                daliagents.com
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Uniquely named so the keyframes cannot collide with app animations. */}
      <style>{`
        @keyframes hero-dock-marquee-left { 0% { transform: translateX(-60%); } 100% { transform: translateX(0%); } }
        @keyframes hero-dock-marquee-right { 0% { transform: translateX(60%); } 100% { transform: translateX(0%); } }
      `}</style>
    </div>
  )
}

/** The pill that holds the tiles; its tooltips share one provider so moving along the bar skips the open delay. */
export function HeroDockBar({ className, children, ...props }: ComponentProps<"div">): JSX.Element {
  return (
    <TooltipProvider>
      <div
        {...props}
        className={cn(
          "flex items-center gap-3 rounded-[28px] bg-(--surface-raised)/85 px-3 py-2 shadow-[inset_0_1px_0_var(--surface-highlight),0_10px_30px_-12px_rgb(0_0_0/0.6)] ring-1 ring-(--hairline-strong) backdrop-blur-lg sm:gap-5 sm:rounded-[48px] sm:px-6 sm:py-3",
          className
        )}
      >
        {children}
      </div>
    </TooltipProvider>
  )
}

export function HeroDockSeparator({ className }: { className?: string }): JSX.Element {
  return (
    <span
      className={cn("mx-1 hidden h-6 w-px bg-(--hairline-strong) sm:block", className)}
      aria-hidden="true"
    />
  )
}

export type HeroDockIconProps = Omit<ComponentProps<"button">, "children"> & {
  /** The tile glyph; children render after it, for a glyph that is not an icon (initials) or a status dot. */
  icon?: LucideIcon
  children?: ReactNode
  /** Accessible name and default tooltip text. */
  label: string
  /** Richer tooltip body; defaults to the label. */
  tip?: ReactNode
  side?: "top" | "bottom"
  badge?: string
}

export function HeroDockIcon({
  icon: Icon,
  children,
  label,
  tip,
  side = "bottom",
  badge,
  className,
  ...props
}: HeroDockIconProps): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          {...props}
          className={cn(
            "group relative grid shrink-0 place-items-center bg-linear-to-b from-(--surface-control-hover) to-(--surface-control) text-foreground/85 shadow-[inset_0_1px_0_var(--surface-highlight)] ring-1 ring-(--hairline-strong) outline-none h-12 w-12 rounded-xl transition-transform duration-200 hover:-translate-y-1 hover:scale-[1.05] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-14 sm:w-14",
            // Hover halo: a drop shadow that fades in under the lifted tile.
            "after:pointer-events-none after:absolute after:-inset-0.5 after:rounded-[inherit] after:opacity-0 after:shadow-[0_10px_24px_-10px_rgb(0_0_0/0.7)] after:transition-opacity after:duration-250 hover:after:opacity-100",
            className
          )}
        >
          {Icon ? (
            <Icon className="h-5 w-5 transition-transform duration-200 group-hover:scale-110" strokeWidth={2.1} />
          ) : null}
          {children}
          {badge ? (
            <span className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-foreground px-1 text-[10px] font-semibold text-background">
              {badge}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-64">
        {tip ?? label}
      </TooltipContent>
    </Tooltip>
  )
}
