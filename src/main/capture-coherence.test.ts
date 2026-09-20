import assert from 'node:assert/strict'
import test from 'node:test'
import { coherenceVerdict, describeCoherence, documentHidden, observeDomMutations, type CaptureCoherence } from './capture-coherence.ts'

function fakeContents(behaviour: { observe?: unknown; read?: unknown; throwOn?: 'observe' | 'read' }) {
  const scripts: string[] = []
  return {
    scripts,
    destroyed: false,
    isDestroyed() { return this.destroyed },
    async executeJavaScript(code: string) {
      scripts.push(code)
      const reading = code.includes('state.observer.disconnect();\n  delete')
      if (behaviour.throwOn === (reading ? 'read' : 'observe')) throw new Error('page gone')
      return reading ? behaviour.read : behaviour.observe
    }
  }
}

test('mutation observation counts what the page reports and stops observing on read', async () => {
  const contents = fakeContents({ observe: true, read: 3 })
  const read = await observeDomMutations(contents)
  assert.equal(await read(), 3)
  assert.equal(contents.scripts.length, 2)
  assert.match(contents.scripts[0]!, /MutationObserver/)
  assert.match(contents.scripts[1]!, /disconnect/)
})

test('a page that cannot be observed, throws, or closes yields null instead of a wrong count', async () => {
  assert.equal(await (await observeDomMutations(fakeContents({ observe: false, read: 9 })))(), null)
  assert.equal(await (await observeDomMutations(fakeContents({ observe: true, throwOn: 'read' })))(), null)
  assert.equal(await (await observeDomMutations(fakeContents({ throwOn: 'observe' })))(), null)
  const closing = fakeContents({ observe: true, read: 1 })
  const read = await observeDomMutations(closing)
  closing.destroyed = true
  assert.equal(await read(), null)
})

test('verdicts rank stale pixels above DOM churn and describe themselves for the model', () => {
  assert.equal(coherenceVerdict('painted', 0), 'verified')
  assert.equal(coherenceVerdict('settled', 0), 'verified')
  assert.equal(coherenceVerdict('unsettled', 0), 'pixels_changing')
  assert.equal(coherenceVerdict('painted', 4), 'dom_changing')
  assert.equal(coherenceVerdict('unconfirmed', 0), 'possibly_stale')
  assert.equal(coherenceVerdict('unconfirmed', 4), 'possibly_stale')
  assert.equal(coherenceVerdict('painted', null), 'unobserved')
  const base: CaptureCoherence = { startedAt: 'a', finishedAt: 'b', intervalMs: 42, frame: 'painted', domMutations: 0, verdict: 'verified' }
  assert.equal(describeCoherence(base), 'Capture verified: fresh frame painted; DOM unchanged over 42ms')
  assert.equal(describeCoherence({ ...base, frame: 'settled' }), 'Capture verified: hidden tab, two consecutive frames identical; DOM unchanged over 42ms')
  assert.match(describeCoherence({ ...base, frame: 'unsettled', verdict: 'pixels_changing' }), /^Capture pixels changing: hidden tab, consecutive frames differ/)
  assert.equal(describeCoherence({ ...base, domMutations: 1, verdict: 'dom_changing' }), 'Capture dom changing: fresh frame painted; DOM changed 1 time over 42ms')
  assert.match(describeCoherence({ ...base, frame: 'unconfirmed', domMutations: null, verdict: 'possibly_stale' }), /pixels may be stale; DOM not observed/)
})

test('document visibility is read from the page and defaults to visible when unanswerable', async () => {
  assert.equal(await documentHidden({ isDestroyed: () => false, executeJavaScript: async () => 'hidden' }), true)
  assert.equal(await documentHidden({ isDestroyed: () => false, executeJavaScript: async () => 'visible' }), false)
  assert.equal(await documentHidden({ isDestroyed: () => false, executeJavaScript: async () => { throw new Error('gone') } }), false)
})
