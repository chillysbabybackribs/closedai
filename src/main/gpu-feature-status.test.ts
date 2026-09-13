import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeGpuFeatureStatus } from './gpu-feature-status.js'

test('summarizeGpuFeatureStatus keeps the diagnostic fields', () => {
  assert.deepEqual(
    summarizeGpuFeatureStatus({
      gpu_compositing: 'enabled',
      video_decode: 'enabled',
      webgl: 'disabled_software',
      '2d_canvas': 'enabled',
      rasterization: 'disabled'
    }),
    {
      gpu_compositing: 'enabled',
      video_decode: 'enabled',
      webgl: 'disabled_software',
      '2d_canvas': 'enabled',
      rasterization: 'disabled'
    }
  )
})
