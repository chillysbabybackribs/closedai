import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** Only local app-owned bytes enter PDF.js; assets resolve from installed dependencies. */
export async function loadPdf(path: string, expectedHash?: string) {
  const data = new Uint8Array(await readFile(path))
  const documentSha256 = createHash('sha256').update(data).digest('hex')
  if (expectedHash && documentSha256 !== expectedHash) throw new Error('Retained PDF bytes do not match the source revision')
  const assets = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const loading = getDocument({
    data, useWorkerFetch: false, disableFontFace: true, useSystemFonts: false,
    enableXfa: false, stopAtErrors: true, verbosity: VerbosityLevel.ERRORS,
    maxImageSize: 16_000_000,
    cMapUrl: join(assets, 'cmaps') + sep, standardFontDataUrl: join(assets, 'standard_fonts') + sep,
    wasmUrl: join(assets, 'wasm') + sep
  })
  return { loading, documentSha256 }
}
