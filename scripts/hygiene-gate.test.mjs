import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('size advisories pass while dependency violations still block', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'closedai-hygiene-'))
  try {
    await mkdir(path.join(root, 'scripts'))
    await mkdir(path.join(root, 'src/shared'), { recursive: true })
    await copyFile(new URL('./hygiene-gate.mjs', import.meta.url), path.join(root, 'scripts/hygiene-gate.mjs'))
    const gate = path.join(root, 'scripts/hygiene-gate.mjs')
    const fixture = path.join(root, 'src/shared/large.ts')
    await writeFile(fixture, '// cohesive code\n'.repeat(676) + `// ${'x'.repeat(60_001)}\n`)
    const summary = execFileSync(process.execPath, [gate], { encoding: 'utf8' })
    assert.match(summary, /1 files exceed review thresholds \(non-blocking\)/)
    assert.doesNotMatch(summary, /large\.ts/)
    const details = execFileSync(process.execPath, [gate, '--details'], { encoding: 'utf8' })
    assert.match(details, /large\.ts: 677\/675 lines, \d+\/60000 bytes/)

    await writeFile(fixture, "import '../main/service'\n")
    const blocked = spawnSync(process.execPath, [gate], { encoding: 'utf8' })
    assert.equal(blocked.status, 1)
    assert.match(blocked.stderr, /shared code must not depend on an application layer/)

    await writeFile(fixture, '// ordinary code\n'.repeat(600))
    const ordinary = execFileSync(process.execPath, [gate], { encoding: 'utf8' })
    assert.doesNotMatch(ordinary, /advisory|near limit/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
