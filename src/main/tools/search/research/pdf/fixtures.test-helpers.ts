import { deflateSync } from 'node:zlib'
import { createCanvas } from '@napi-rs/canvas'

/** Small real PDFs: native text, raster-only scans, mixed content, rotation, and blank pages. */
export function pdfFixture(pages: Array<{ text?: string; scan?: string; rotate?: number }>): Uint8Array<ArrayBuffer> {
  const objects: Buffer[] = [Buffer.alloc(0), Buffer.alloc(0), Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')]
  const add = (body: Buffer | string) => { objects.push(Buffer.from(body)); return objects.length }
  const stream = (data: Buffer, dictionary = '') => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')])
  const kids: number[] = []
  for (const page of pages) {
    let commands = ''
    let imageId = 0
    if (page.scan) {
      const canvas = createCanvas(800, 300)
      const context = canvas.getContext('2d')
      context.fillStyle = 'white'; context.fillRect(0, 0, 800, 300)
      context.fillStyle = 'black'; context.font = '36px sans-serif'; context.fillText(page.scan, 30, 170)
      const rgba = context.getImageData(0, 0, 800, 300).data
      const rgb = Buffer.alloc(800 * 300 * 3)
      for (let i = 0; i < 800 * 300; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = rgba[i * 4 + c]
      imageId = add(stream(deflateSync(rgb), '/Type /XObject /Subtype /Image /Width 800 /Height 300 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode'))
      commands += 'q 800 0 0 300 0 0 cm /Im0 Do Q\n'
    }
    if (page.text) commands += `BT /F1 24 Tf 30 250 Td (${page.text.replace(/[()\\]/g, '\\$&')}) Tj ET\n`
    const content = add(stream(Buffer.from(commands)))
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 300] /Rotate ${page.rotate ?? 0} /Resources << /Font << /F1 3 0 R >> ${imageId ? `/XObject << /Im0 ${imageId} 0 R >>` : ''} >> /Contents ${content} 0 R >>`))
  }
  objects[0] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>')
  objects[1] = Buffer.from(`<< /Type /Pages /Count ${pages.length} /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] >>`)
  const parts = [Buffer.from('%PDF-1.4\n')]
  const offsets = [0]
  let size = parts[0].length
  objects.forEach((body, i) => {
    offsets.push(size)
    const part = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')])
    parts.push(part); size += part.length
  })
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`))
  return new Uint8Array(Buffer.concat(parts))
}
