import { ref, computed } from 'vue'
import type { Asset } from '~~/shared/timeline/types'

const assets = ref<Asset[]>([])
const loading = ref(false)

export function useAssetLibrary() {
  async function fetchAssets() {
    loading.value = true
    try {
      const res = await fetch('/comfynext/assets')
      const data = await res.json()
      assets.value = data.assets ?? []
    } catch {
      assets.value = []
    } finally {
      loading.value = false
    }
  }

  async function importAsset(path: string): Promise<Asset | null> {
    try {
      const res = await fetch('/comfynext/asset_import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      const data = await res.json()
      if (data.asset) {
        if (data.created) assets.value.push(data.asset)
        return data.asset
      }
    } catch {}
    return null
  }

  async function removeAsset(assetId: string) {
    try {
      await fetch(`/comfynext/assets/${assetId}`, { method: 'DELETE' })
      assets.value = assets.value.filter(a => a.id !== assetId)
    } catch {}
  }

  async function fetchInputFiles(): Promise<Array<{ filename: string; path: string; type: string; size: number }>> {
    try {
      const res = await fetch('/comfynext/input_listing')
      const data = await res.json()
      return data.items ?? []
    } catch {
      return []
    }
  }

  function getAsset(id: string): Asset | undefined {
    return assets.value.find(a => a.id === id)
  }

  function assetUrl(asset: Asset): string {
    const filename = asset.path.split('/').pop() ?? asset.name
    return `/view?${new URLSearchParams({ filename, type: 'input' })}`
  }

  const videoAssets = computed(() => assets.value.filter(a => a.kind === 'video'))
  const imageAssets = computed(() => assets.value.filter(a => a.kind === 'image'))
  const audioAssets = computed(() => assets.value.filter(a => a.kind === 'audio'))

  return {
    assets,
    loading,
    videoAssets,
    imageAssets,
    audioAssets,
    fetchAssets,
    importAsset,
    removeAsset,
    fetchInputFiles,
    getAsset,
    assetUrl,
  }
}
