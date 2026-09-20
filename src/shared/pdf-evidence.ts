/** Derived, untrusted evidence from one immutable retained PDF revision. */
export type PdfCrop = { x: number; y: number; width: number; height: number }
export type PdfInspectionRequest = {
  action: 'page' | 'ocr'
  page: number
  dpi: number
  /** Fractions of the rotated page, with top-left origin. */
  crop?: PdfCrop
}
export type PdfTextItem = { text: string; transform: number[]; width: number; height: number }
export type PdfOcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
export type PdfPageEvidence = {
  documentSha256: string
  page: number
  totalPages: number
  width: number
  height: number
  requestedDpi: number
  effectiveDpi: number
  crop: PdfCrop
  /** PDF coordinates -> rotated page coordinates at 72 dpi, before crop. */
  pageTransform: number[]
  /** Empty drawing operations can mean a blank page or an incomplete PDF.js render. */
  renderIncomplete: boolean
  native: { text: string; items: PdfTextItem[]; incomplete: boolean; scope: 'whole_page' }
  image?: string
  ocr?: {
    text: string; words: PdfOcrWord[]; confidence: number; incomplete: boolean
    engine: string; language: 'eng'; coordinateSpace: 'rendered_crop_pixels'
  }
}
