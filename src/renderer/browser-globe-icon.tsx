import { useEffect, useRef, useState } from 'react'

const fallbackUrl = new URL('./assets/browser-globe-natural-earth.png', import.meta.url).href
// Same Earth texture as the approved motion preview, bundled for offline use.
// https://github.com/mrdoob/three.js/blob/r160/examples/textures/planets/earth_atmos_2048.jpg
const textureUrl = new URL('./assets/browser-earth-texture.jpg', import.meta.url).href
const resolution = 96
const tilt = 15 * Math.PI / 180
const revolutionMs = 24_000

export function BrowserGlobeIcon({ size = 24 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const pixels = context.createImageData(resolution, resolution)
    const points: { offset: number; latitude: number; azimuth: number; light: number; rim: number }[] = []
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const nx = (x + 0.5 - resolution / 2) / (resolution / 2 - 1.5)
        const ny = -(y + 0.5 - resolution / 2) / (resolution / 2 - 1.5)
        const radius = Math.hypot(nx, ny)
        if (radius >= 1) continue
        const nz = Math.sqrt(1 - radius * radius)
        // Inverse axial tilt for texture coordinates; lighting stays fixed in view space.
        const globeX = nx * Math.cos(tilt) - ny * Math.sin(tilt)
        const globeY = nx * Math.sin(tilt) + ny * Math.cos(tilt)
        const offset = (y * resolution + x) * 4
        pixels.data[offset + 3] = Math.min(1, (1 - radius) * (resolution / 2 - 1.5)) * 255
        points.push({ offset, latitude: Math.asin(globeY), azimuth: Math.atan2(globeX, nz),
          light: 0.48 + Math.max(0, nx * -0.35 + ny * 0.4 + nz * 0.846) * 0.7,
          rim: Math.pow(1 - nz, 4) * 0.42 })
      }
    }

    let texture: ImageData | undefined
    let longitude = -0.8
    let frame = 0
    let previousTime: number | undefined
    let disposed = false
    const atmosphere = [65, 145, 235]

    function draw() {
      if (!texture || !context) return
      for (const point of points) {
        const u = ((point.azimuth + longitude) / (2 * Math.PI) + 2.5) % 1
        const v = 0.5 - point.latitude / Math.PI
        const source = (Math.min(texture.height - 1, Math.floor(v * texture.height)) * texture.width
          + Math.floor(u * texture.width)) * 4
        for (let channel = 0; channel < 3; channel++) {
          pixels.data[point.offset + channel] = texture.data[source + channel] * point.light * (1 - point.rim)
            + atmosphere[channel] * point.rim
        }
      }
      context.putImageData(pixels, 0, 0)
    }

    function running() {
      return !disposed && texture && !document.hidden && !reduced.matches
    }

    function tick(time: number) {
      frame = 0
      if (!running()) { previousTime = undefined; return }
      if (previousTime === undefined) previousTime = time
      const elapsed = time - previousTime
      // A small toolbar globe only needs 30 fps, even on a high-refresh display.
      if (elapsed >= 1000 / 30) {
        longitude = (longitude + Math.min(elapsed, 100) / revolutionMs * Math.PI * 2) % (Math.PI * 2)
        previousTime = time
        draw()
      }
      frame = requestAnimationFrame(tick)
    }

    function sync() {
      if (running() && !frame) frame = requestAnimationFrame(tick)
      if (!running()) {
        cancelAnimationFrame(frame)
        frame = 0
        previousTime = undefined
      }
    }
    reduced.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)

    const map = new Image()
    map.onload = () => {
      if (disposed) return
      const source = document.createElement('canvas')
      source.width = 1024
      source.height = 512
      const sourceContext = source.getContext('2d', { willReadFrequently: true })
      if (!sourceContext) return
      sourceContext.drawImage(map, 0, 0, source.width, source.height)
      texture = sourceContext.getImageData(0, 0, source.width, source.height)
      draw()
      setReady(true)
      sync()
    }
    map.src = textureUrl

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      map.onload = null
      reduced.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  return (
    <span className="browser-globe-icon" style={{ width: size, height: size }} aria-hidden="true">
      <img src={fallbackUrl} width={size} height={size} alt="" draggable={false} hidden={ready} />
      <canvas ref={canvasRef} width={resolution} height={resolution} hidden={!ready} />
    </span>
  )
}
