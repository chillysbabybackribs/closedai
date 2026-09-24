import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  GENERATE_IMAGE_LABEL,
  imageUrlFromContentBlocks,
  isNativeGenerateImageTool,
  promoteGeneratedImage,
  resolveGeneratedImageEvidence
} from './generated-image-transcript.js'

test('native generate-image tool names normalize consistently', () => {
  assert.equal(isNativeGenerateImageTool('generate_image'), true)
  assert.equal(isNativeGenerateImageTool('GenerateImage'), true)
  assert.equal(isNativeGenerateImageTool('image_generation'), true)
  assert.equal(isNativeGenerateImageTool('Read'), false)
})

test('promoteGeneratedImage requires a successful image url', () => {
  assert.deepEqual(promoteGeneratedImage({
    itemId: 'g1', turnId: 't1', failed: false, imageUrl: 'data:image/png;base64,QQ=='
  }), {
    type: 'screenshot', id: 'g1', turnId: 't1', imageUrl: 'data:image/png;base64,QQ==',
    surface: 'generated_image', caption: ''
  })
  assert.equal(promoteGeneratedImage({
    itemId: 'g1', turnId: 't1', failed: true, imageUrl: 'data:image/png;base64,QQ=='
  }), null)
})

test('resolveGeneratedImageEvidence reads data urls and image blocks', () => {
  assert.deepEqual(resolveGeneratedImageEvidence('Saved data:image/png;base64,QQ=='), {
    imageUrl: 'data:image/png;base64,QQ=='
  })
  assert.deepEqual(imageUrlFromContentBlocks([
    { type: 'image', mimeType: 'image/png', data: 'QQ==' }
  ]), { imageUrl: 'data:image/png;base64,QQ==' })
})

test('resolveGeneratedImageEvidence reads markdown artifacts and file links', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-gen-md-'))
  try {
    const imagePath = join(dir, 'puppy.jpg')
    await writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff]))
    const mdPath = join(dir, 'puppy.md')
    await writeFile(mdPath, `# Puppy\n\n![Puppy](${imagePath})\n`)
    const evidence = resolveGeneratedImageEvidence(`Saved artifact ${mdPath}`)
    assert.ok(evidence)
    assert.equal(evidence.savedPath, imagePath)
    assert.match(evidence.imageUrl, /^data:image\/jpeg;base64,/)
    const linked = resolveGeneratedImageEvidence('![Puppy](/tmp/puppy.png)')
    assert.equal(linked, null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('resolveGeneratedImageEvidence loads a saved image path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-gen-img-'))
  try {
    const path = join(dir, 'out.png')
    await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const evidence = resolveGeneratedImageEvidence(`Image written to ${path}`)
    assert.ok(evidence)
    assert.equal(evidence.savedPath, path)
    assert.match(evidence.imageUrl, /^data:image\/png;base64,/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('generate image label is stable for activity rows', () => {
  assert.equal(GENERATE_IMAGE_LABEL, 'Generate image')
})
