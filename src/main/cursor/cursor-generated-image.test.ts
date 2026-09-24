import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  cursorGenerateImageHintPaths,
  cursorProjectAssetsDir,
  resolveCursorGeneratedImageEvidence
} from './cursor-generated-image.js'

test('cursorProjectAssetsDir maps workspace cwd to Cursor project slug', () => {
  const previousHome = process.env.HOME
  process.env.HOME = '/home/test'
  try {
    assert.equal(
      cursorProjectAssetsDir('/home/dp/Desktop/closedai'),
      '/home/test/.cursor/projects/home-dp-Desktop-closedai/assets'
    )
  } finally {
    process.env.HOME = previousHome
  }
})

test('cursorGenerateImageHintPaths expands bare filenames into asset paths', () => {
  const previousHome = process.env.HOME
  process.env.HOME = '/home/test'
  try {
    assert.deepEqual(
      cursorGenerateImageHintPaths('/repo', { filename: 'puppy.png', description: 'cute' }),
      ['puppy.png', 'cute', '/home/test/.cursor/projects/repo/assets/puppy.png']
    )
  } finally {
    process.env.HOME = previousHome
  }
})

test('resolveCursorGeneratedImageEvidence reads a recent Cursor asset when output is empty', async () => {
  const home = await mkdtemp(join(tmpdir(), 'closedai-cursor-asset-'))
  const previousHome = process.env.HOME
  process.env.HOME = home
  try {
    const cwd = '/home/dp/Desktop/closedai'
    const assets = join(home, '.cursor/projects/home-dp-Desktop-closedai/assets')
    await mkdir(assets, { recursive: true })
    const path = join(assets, 'out.png')
    await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const evidence = resolveCursorGeneratedImageEvidence({
      cwd,
      rawInput: { description: 'icon' },
      text: '',
      startedAtMs: Date.now() - 500
    })
    assert.ok(evidence)
    assert.equal(evidence.savedPath, path)
  } finally {
    process.env.HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
