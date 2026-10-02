import { createContext, useContext } from 'react'
import type { CanvasSize } from './layout-presets.js'

const TileSizeContext = createContext<CanvasSize>({ width: 10_000, height: 10_000 })

export const TileSizeProvider = TileSizeContext.Provider

export function useTileSize(): CanvasSize {
  return useContext(TileSizeContext)
}
