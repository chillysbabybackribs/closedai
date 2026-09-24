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

// A glass icon dock on a dark hero: raised square tiles that lift on hover, show their label
// beneath, and carry an optional count badge. The classes are the published component's own;
// only its global stylesheet was turned into scoped utilities. HeroDockBar, HeroDockIcon and
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
              <HeroDockBar>
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

/** The published Dock: a pill bar, drawn slightly under size as the original is. */
export function HeroDockBar({ className, children, ...props }: ComponentProps<"div">): JSX.Element {
  return (
    <div data-slot="hero-dock-frame" className="relative flex scale-90 items-center gap-2 sm:scale-95 sm:gap-4">
      <div
        data-slot="hero-dock-bar"
        {...props}
        className={cn(
          "flex items-center gap-3 rounded-[28px] bg-neutral-900/80 px-3 py-2 shadow-2xl ring-1 ring-white/10 backdrop-blur-lg sm:gap-5 sm:rounded-[48px] sm:px-6 sm:py-3",
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function HeroDockSeparator(): JSX.Element {
  return <span data-slot="hero-dock-separator" className="mx-1 hidden h-6 w-px bg-white/10 sm:block" aria-hidden="true" />
}

export type HeroDockIconProps = Omit<ComponentProps<"button">, "children"> & {
  /** The tile glyph; children render after it, for a glyph that is not an icon such as initials. */
  icon?: LucideIcon
  children?: ReactNode
  label: string
  badge?: string
}

export function HeroDockIcon({ icon: Icon, children, label, badge, className, ...props }: HeroDockIconProps): JSX.Element {
  return (
    <button
      type="button"
      data-slot="hero-dock-icon"
      aria-label={label}
      {...props}
      className={cn(
        "group relative grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-b from-neutral-800/60 to-neutral-900/70 text-white/85 shadow-lg ring-1 ring-white/10 outline-none backdrop-blur-xl transition-transform duration-200 hover:-translate-y-1 hover:scale-[1.05] focus-visible:ring-2 focus-visible:ring-white/50 sm:h-14 sm:w-14",
        // The published .hover-halo: a faint outer ring and drop shadow that fade in on hover.
        "after:pointer-events-none after:absolute after:-inset-0.5 after:rounded-[inherit] after:opacity-0 after:shadow-[0_0_0_0_rgba(255,255,255,.18),0_12px_30px_-10px_rgba(0,0,0,.7)] after:transition-opacity after:duration-250 hover:after:opacity-100",
        className
      )}
    >
      {Icon ? <Icon className="h-5 w-5 transition-transform duration-200 group-hover:scale-110" strokeWidth={2.1} /> : null}
      {children}
      {badge ? (
        <span data-slot="hero-dock-badge" className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[10px] font-semibold text-neutral-900 ring-1 ring-white/80">
          {badge}
        </span>
      ) : null}
      {/* The published .tooltip: rests 6px low and transparent, rises into place on hover or focus. */}
      <span data-slot="hero-dock-label" className="pointer-events-none absolute -bottom-6 translate-y-[calc(50%+6px)] whitespace-nowrap text-[9px] tracking-wide text-white/70 opacity-0 transition-[opacity,translate] duration-200 group-hover:translate-y-1/2 group-hover:opacity-100 group-focus-visible:translate-y-1/2 group-focus-visible:opacity-100 sm:text-[10px]">
        {label}
      </span>
    </button>
  )
}
