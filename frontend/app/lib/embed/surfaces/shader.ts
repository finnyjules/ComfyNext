import type { EmbedSurface } from '../contract'

// Filled in by Task 4. Present now so the registry's dynamic import resolves.
const shaderEmbedSurface: EmbedSurface = {
  kind: 'shader',
  caps: { alpha: false },
  async mount() {
    throw new Error('shader embed adapter not implemented yet')
  },
}

export default shaderEmbedSurface
