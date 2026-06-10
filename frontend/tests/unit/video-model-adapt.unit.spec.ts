import { describe, it, expect } from 'vitest'
import { VIDEO_MODELS, VIDEO_MODELS_BY_ID } from '../../app/data/video-models'

// Audit of comfy_api_nodes/video_models.py (2026-06-10): every builder calls
// _maybe_set_seed except _b_kling_v2_5_turbo_pro (Replicate 422s on seed) and
// _b_fabric_1_0 (lip-sync, no seed input).
const NO_SEED_IDS = ['kling-v2.5-turbo-pro', 'fabric-1.0']

describe('video-models supportsSeed flag', () => {
  it('every model declares a boolean supportsSeed', () => {
    for (const m of VIDEO_MODELS) {
      expect(typeof (m as any).supportsSeed, `${m.id} missing supportsSeed`).toBe('boolean')
    }
  })

  it('flags match the Python builder audit', () => {
    for (const m of VIDEO_MODELS) {
      const expected = !NO_SEED_IDS.includes(m.id)
      expect((m as any).supportsSeed, m.id).toBe(expected)
    }
    for (const id of NO_SEED_IDS) {
      expect(VIDEO_MODELS_BY_ID[id], `${id} missing from registry`).toBeTruthy()
    }
  })
})
