import type { VarBinding } from '~/lib/collection/types'

/** A VarBinding that points at a named `@ref` instead of a collection column. */
export function refBinding(refName: string): VarBinding {
  return { kind: 'reference', refName, collectionId: '', columnKey: '' }
}

export function isRefBinding(b: VarBinding | undefined): boolean {
  return !!b && b.kind === 'reference' && !!b.refName
}

export function refBindingLabel(b: VarBinding | undefined): string | null {
  return isRefBinding(b) ? `@${b!.refName}` : null
}
