// Registers the `.js`→`.ts` resolution hook on the module loader thread. Loaded via
// `node --import` from the test script so it is active before any test module is resolved.
import { register } from 'node:module'

register(new URL('./ts-resolve-hook.mjs', import.meta.url))
