// ESM hooks for the test runner: resolve `./x.js` specifiers to their `.ts`/`.tsx` source, and
// transform `.tsx` (which Node cannot parse at all) into plain JS.
//
// The source uses NodeNext `.js` import specifiers that point at sibling `.ts` files (the
// TypeScript convention, and what electron-vite/tsc resolve at build time). Node's built-in
// type stripping (`--experimental-transform-types`) erases *type-only* `.js` imports but does
// NOT rewrite *value* `.js` imports to their `.ts` source — so a unit test that loads a module
// with a value `.js` import fails with ERR_MODULE_NOT_FOUND. This hook closes that gap for the
// test runner only, so any module can be unit-tested regardless of how deep its import graph is.
//
// The `.tsx` half is a separate gap: Node's type stripping removes TYPES but does not transform
// JSX, and it does not even recognise the `.tsx` extension (ERR_UNKNOWN_FILE_EXTENSION). That
// made every React component — and every pure helper that merely imported one — untestable. The
// load hook runs esbuild over `.tsx` sources so components can be rendered in tests.
//
// Both halves are deliberately narrow: a `.js` specifier is only rewritten when the `.js` does
// not resolve on its own but the sibling source exists, and only `.tsx` files are transformed.
// Real `.js` files and package imports are untouched.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const SOURCE_EXTENSIONS = ['.ts', '.tsx']

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
    try {
      return await nextResolve(specifier, context)
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
      for (const extension of SOURCE_EXTENSIONS) {
        const candidate = `${specifier.slice(0, -3)}${extension}`
        let resolved
        try {
          resolved = await nextResolve(candidate, context)
        } catch {
          continue
        }
        // Guard: only accept the rewrite if the source genuinely exists on disk.
        if (resolved.url.startsWith('file:') && existsSync(fileURLToPath(resolved.url))) return resolved
      }
      throw error
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !url.endsWith('.tsx')) return nextLoad(url, context)
  // jsx: 'automatic' emits react/jsx-runtime imports, so components need no React in scope.
  const { code } = transformSync(readFileSync(fileURLToPath(url), 'utf8'), {
    loader: 'tsx',
    format: 'esm',
    jsx: 'automatic',
    target: 'node20',
    sourcefile: url,
    sourcemap: 'inline'
  })
  return { format: 'module', source: code, shortCircuit: true }
}
