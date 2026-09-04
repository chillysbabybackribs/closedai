import assert from 'node:assert/strict'
import test from 'node:test'
import { projectJson, selectPath } from './project.js'

const document = {
  data: {
    items: [
      { name: 'One', revenue: { mrr: 10, total: 100 }, tags: ['a'] },
      { name: 'Two', revenue: { mrr: 20, total: 200 }, tags: ['b'] },
      { name: 'Three', revenue: { mrr: 30, total: 300 }, tags: ['c'] }
    ]
  }
}

test('selectPath walks objects, arrays, and bracket syntax', () => {
  assert.equal(selectPath(document, 'data.items[1].name'), 'Two')
  assert.equal(selectPath(document, 'data[items][0][revenue][mrr]'), 10)
  assert.equal(selectPath(document, undefined), document)
})

test('selectPath returns undefined rather than throwing on a bad path', () => {
  assert.equal(selectPath(document, 'data.missing.deeper'), undefined)
  assert.equal(selectPath(document, 'data.items[9].name'), undefined)
  assert.equal(selectPath(document, 'data.items[0].name.nope'), undefined)
})

test('projectJson keeps only the named fields, naming each by its path', () => {
  const result = projectJson(document, { path: 'data.items', fields: ['name', 'revenue.mrr'] })
  assert.deepEqual(result.value, [
    { name: 'One', 'revenue.mrr': 10 },
    { name: 'Two', 'revenue.mrr': 20 },
    { name: 'Three', 'revenue.mrr': 30 }
  ])
  assert.equal(result.matched, 3)
  assert.equal(result.limited, false)
})

test('projectJson caps items and reports that it did', () => {
  const result = projectJson(document, { path: 'data.items', fields: ['name'], limit: 2 })
  assert.deepEqual(result.value, [{ name: 'One' }, { name: 'Two' }])
  assert.equal(result.matched, 3)
  assert.equal(result.limited, true)
})

test('projectJson omits fields an item does not have instead of emitting undefined', () => {
  const result = projectJson({ rows: [{ a: 1 }, { a: 2, b: 3 }] }, { path: 'rows', fields: ['a', 'b'] })
  assert.deepEqual(result.value, [{ a: 1 }, { a: 2, b: 3 }])
})

test('projectJson projects a lone object and reports no array match', () => {
  const result = projectJson(document, { path: 'data.items[0]', fields: ['name'] })
  assert.deepEqual(result.value, { name: 'One' })
  assert.equal(result.matched, null)
})

test('projectJson passes the whole selection through when no fields are named', () => {
  const result = projectJson(document, { path: 'data.items', limit: 1 })
  assert.deepEqual(result.value, [document.data.items[0]])
})
