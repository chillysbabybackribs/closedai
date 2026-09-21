import type { ImgHTMLAttributes } from 'react'

// The selected Natural Earth artwork, bundled locally at 4× its 24px display size.
const globeUrl = new URL('./assets/browser-globe-natural-earth.png', import.meta.url).href

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & { size?: number }

export function BrowserGlobeIcon({ size = 24, ...rest }: Props) {
  return <img {...rest} src={globeUrl} width={size} height={size} alt="" aria-hidden="true" draggable={false} />
}
