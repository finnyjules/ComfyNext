/**
 * Reactive state container for the template editor — loaded template, current
 * aspect, selection, dirty tracking. One instance per tab (provided/injected).
 *
 * The component tree mutates `template.value` freely; we deep-clone before
 * sending to the render endpoint or save endpoint so reactivity proxies don't
 * leak through structured-cloning code paths.
 */
import type {
  AspectSpec, LayoutElement, RenderBrand, RenderProps, Template,
} from '~~/server/templates/schema'

export function useTemplateEditor(initial: Template) {
  // JSON round-trip instead of `structuredClone` — Vue reactive proxies (which
  // is what `initial` is when the parent passes a ref'd template) contain
  // Symbols / non-cloneable bits that structuredClone refuses with DataCloneError.
  // The JSON path strips those and gives us a clean plain-object snapshot.
  const template = ref<Template>(JSON.parse(JSON.stringify(initial)))
  const currentAspect = ref<string>(initial.defaultAspect ?? Object.keys(initial.aspects)[0])
  const selectedId = ref<string | null>(null)
  const dirty = ref(false)
  const saving = ref(false)
  const saveError = ref<string | null>(null)

  // Sample data used for the live preview — lets the canvas show something
  // recognisable instead of raw "{{ props.headline }}" tokens.
  const sampleProps = ref<RenderProps>({
    headline: 'Spring drop is here',
    subhead: 'Limited run, ships Friday.',
    hero: 'https://images.unsplash.com/photo-1503602642458-232111445657?w=1200',
  })
  const sampleBrand = ref<RenderBrand>({
    primary: '#0a0a0a',
    secondary: '#1a1a1a',
    accent: '#96b4ff',
    foreground: '#ffffff',
  })

  const aspect = computed<AspectSpec>(() => template.value.aspects[currentAspect.value])
  const selectedElement = computed<LayoutElement | null>(() => {
    if (!selectedId.value) return null
    return template.value.elements.find((e) => e.id === selectedId.value) ?? null
  })

  /** Mutate the element in place. Always writes to the base — used for fields
   * that don't make sense to vary per aspect (id, type, shape). */
  function patchElement(id: string, patch: Partial<LayoutElement>) {
    const idx = template.value.elements.findIndex((e) => e.id === id)
    if (idx === -1) return
    const merged = { ...template.value.elements[idx], ...patch } as LayoutElement
    template.value.elements.splice(idx, 1, merged)
    dirty.value = true
  }

  /** Default aspect — the one that lives at the base level. Falls back to the
   * first aspect when not explicitly set on the template. */
  const defaultAspect = computed(() =>
    template.value.defaultAspect ?? Object.keys(template.value.aspects)[0],
  )
  const editingOverride = computed(() => currentAspect.value !== defaultAspect.value)

  /**
   * Aspect-aware mutation. In the default aspect this writes to the base, same
   * as patchElement. In any other aspect it writes to overrides[currentAspect]
   * as a *delta* — only the keys we touch live in the override, everything
   * else still inherits from base.
   *
   * `style` is shallow-merged into the override's style so individual style
   * fields can be overridden independently without losing siblings.
   */
  function patchEffective(id: string, patch: Partial<LayoutElement>) {
    const idx = template.value.elements.findIndex((e) => e.id === id)
    if (idx === -1) return
    const el = template.value.elements[idx]

    if (!editingOverride.value) {
      const merged: any = { ...el, ...patch }
      if ((patch as any).style) {
        merged.style = { ...(el as any).style, ...((patch as any).style ?? {}) }
      }
      template.value.elements.splice(idx, 1, merged as LayoutElement)
    } else {
      const key = currentAspect.value
      const overrides = { ...(el.overrides ?? {}) }
      const cur = overrides[key] ?? {}
      const merged: any = { ...cur, ...patch }
      if ((patch as any).style) {
        merged.style = { ...(cur as any).style ?? {}, ...((patch as any).style ?? {}) }
      }
      overrides[key] = merged
      const newEl = { ...el, overrides } as LayoutElement
      template.value.elements.splice(idx, 1, newEl)
    }
    dirty.value = true
  }

  /** Remove a single top-level field's override for the current aspect. */
  function clearOverrideField(id: string, field: keyof LayoutElement) {
    if (!editingOverride.value) return
    const idx = template.value.elements.findIndex((e) => e.id === id)
    if (idx === -1) return
    const el = template.value.elements[idx]
    const key = currentAspect.value
    const cur = el.overrides?.[key]
    if (!cur || !(field in cur)) return
    const { [field]: _, ...rest } = cur as Record<string, unknown>
    const overrides = { ...el.overrides }
    if (Object.keys(rest).length === 0) {
      delete overrides[key]
    } else {
      overrides[key] = rest as any
    }
    template.value.elements.splice(idx, 1, { ...el, overrides } as LayoutElement)
    dirty.value = true
  }

  /** Remove a single style sub-key's override for the current aspect. */
  function clearOverrideStyleField(id: string, styleField: string) {
    if (!editingOverride.value) return
    const idx = template.value.elements.findIndex((e) => e.id === id)
    if (idx === -1) return
    const el = template.value.elements[idx]
    const key = currentAspect.value
    const cur = el.overrides?.[key] as any
    if (!cur?.style || !(styleField in cur.style)) return
    const { [styleField]: _, ...restStyle } = cur.style
    const newOverride: any = { ...cur }
    if (Object.keys(restStyle).length === 0) {
      delete newOverride.style
    } else {
      newOverride.style = restStyle
    }
    const overrides = { ...el.overrides }
    if (Object.keys(newOverride).length === 0) {
      delete overrides[key]
    } else {
      overrides[key] = newOverride
    }
    template.value.elements.splice(idx, 1, { ...el, overrides } as LayoutElement)
    dirty.value = true
  }

  /** Reset every override for the current aspect on this element. */
  function clearAllOverrides(id: string) {
    if (!editingOverride.value) return
    const idx = template.value.elements.findIndex((e) => e.id === id)
    if (idx === -1) return
    const el = template.value.elements[idx]
    const overrides = { ...(el.overrides ?? {}) }
    delete overrides[currentAspect.value]
    template.value.elements.splice(idx, 1, { ...el, overrides } as LayoutElement)
    dirty.value = true
  }

  /** Whether a given top-level field has an override in the current aspect. */
  function hasOverride(el: LayoutElement, field: keyof LayoutElement): boolean {
    if (!editingOverride.value) return false
    const cur = el.overrides?.[currentAspect.value]
    return !!cur && field in cur
  }

  /** Whether a given style sub-key has an override in the current aspect. */
  function hasStyleOverride(el: LayoutElement, styleField: string): boolean {
    if (!editingOverride.value) return false
    const cur = el.overrides?.[currentAspect.value] as any
    return !!cur?.style && styleField in cur.style
  }

  function addElement(el: LayoutElement) {
    template.value.elements.push(el)
    selectedId.value = el.id
    dirty.value = true
  }

  function deleteElement(id: string) {
    template.value.elements = template.value.elements.filter((e) => e.id !== id)
    if (selectedId.value === id) selectedId.value = null
    dirty.value = true
  }

  /**
   * Move an element to a specific index in the elements array. Array order
   * is the z-stacking order: later in the array = rendered on top. The
   * LayersPanel displays elements top-to-bottom = front-to-back, so callers
   * there reverse the indices before calling.
   */
  function moveElementTo(id: string, targetIdx: number) {
    const idx = template.value.elements.findIndex((e) => e.id === id)
    if (idx < 0) return
    const clamped = Math.max(0, Math.min(template.value.elements.length - 1, targetIdx))
    if (clamped === idx) return
    const [el] = template.value.elements.splice(idx, 1)
    template.value.elements.splice(clamped, 0, el)
    dirty.value = true
  }

  /** Convenience: shift one step up (closer to front) or down (further back). */
  function moveElement(id: string, dir: 'up' | 'down') {
    const idx = template.value.elements.findIndex((e) => e.id === id)
    if (idx < 0) return
    moveElementTo(id, dir === 'up' ? idx + 1 : idx - 1)
  }

  function setAspect(key: string) {
    if (template.value.aspects[key]) currentAspect.value = key
  }

  function addAspect(key: string, spec: AspectSpec) {
    template.value.aspects = { ...template.value.aspects, [key]: spec }
    currentAspect.value = key
    dirty.value = true
  }

  function removeAspect(key: string) {
    const keys = Object.keys(template.value.aspects)
    if (keys.length <= 1) return
    const rest: Record<string, AspectSpec> = {}
    for (const k of keys) if (k !== key) rest[k] = template.value.aspects[k]
    template.value.aspects = rest
    if (template.value.defaultAspect === key) template.value.defaultAspect = Object.keys(rest)[0]
    if (currentAspect.value === key) currentAspect.value = Object.keys(rest)[0]
    // Clean up orphaned element overrides for the removed aspect
    template.value.elements = template.value.elements.map((el) => {
      if (!el.overrides?.[key]) return el
      const { [key]: _, ...restOv } = el.overrides
      return { ...el, overrides: Object.keys(restOv).length ? restOv : undefined } as LayoutElement
    })
    dirty.value = true
  }

  async function save() {
    saving.value = true
    saveError.value = null
    try {
      const payload = JSON.parse(JSON.stringify(template.value))  // strip reactivity
      const res = await fetch(`/api/templates/${template.value.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Save failed (${res.status})`)
      }
      dirty.value = false
    } catch (e: any) {
      saveError.value = e?.message ?? 'Save failed'
    } finally {
      saving.value = false
    }
  }

  return {
    template, currentAspect, aspect, defaultAspect, editingOverride,
    selectedId, selectedElement,
    dirty, saving, saveError,
    sampleProps, sampleBrand,
    patchElement, patchEffective,
    clearOverrideField, clearOverrideStyleField, clearAllOverrides,
    hasOverride, hasStyleOverride,
    addElement, deleteElement, moveElement, moveElementTo, setAspect, addAspect, removeAspect, save,
  }
}

export type TemplateEditorContext = ReturnType<typeof useTemplateEditor>
