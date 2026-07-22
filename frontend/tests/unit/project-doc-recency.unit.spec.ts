import { describe, it, expect } from 'vitest'
import { pickNewerDoc, stampDocForSave, toProjectDoc, makeBlankWorkflow } from '~/lib/projectDoc'

/** A one-canvas doc with real content, optionally stamped. */
function docWith(savedAt?: number) {
  const doc = toProjectDoc({ ...makeBlankWorkflow(), nodes: [{ id: 1, type: 'Image' }] })
  if (savedAt !== undefined) doc.savedAt = savedAt
  return doc
}

describe('pickNewerDoc', () => {
  it('prefers a strictly newer durable copy when both are stamped', () => {
    const session = docWith(1000)
    const durable = docWith(2000)
    expect(pickNewerDoc(session, durable)).toEqual({ doc: durable, source: 'durable' })
  })

  it('keeps the session copy when it is newer or tied', () => {
    const session = docWith(2000)
    expect(pickNewerDoc(session, docWith(1000)).source).toBe('session')
    expect(pickNewerDoc(session, docWith(2000)).source).toBe('session')
  })

  it('never replaces a legacy unstamped session doc that has content', () => {
    // Pre-upgrade session copies carry no savedAt — their age is unknown, and
    // replacing a fresh-but-unstamped copy with an older durable one is the
    // exact data loss this helper exists to prevent.
    const session = docWith()
    expect(pickNewerDoc(session, docWith(2000)).source).toBe('session')
  })

  it('treats an unstamped durable copy as age 0', () => {
    expect(pickNewerDoc(docWith(1), docWith()).source).toBe('session')
  })

  it('falls back to the durable copy when the session side is empty or missing', () => {
    const durable = docWith(500)
    expect(pickNewerDoc(null, durable)).toEqual({ doc: durable, source: 'durable' })
    expect(pickNewerDoc(toProjectDoc(makeBlankWorkflow()), durable).source).toBe('durable')
  })

  it('keeps the session copy when the durable side is empty or missing', () => {
    const session = docWith(500)
    expect(pickNewerDoc(session, null).source).toBe('session')
    expect(pickNewerDoc(session, toProjectDoc(makeBlankWorkflow())).source).toBe('session')
  })

  it('returns the session side when both are empty', () => {
    expect(pickNewerDoc(null, null).source).toBe('session')
  })
})

describe('stampDocForSave', () => {
  it('bumps savedAt when lastEditAt is newer than the existing stamp', () => {
    const doc = docWith(1000)
    stampDocForSave(doc, 2000)
    expect(doc.savedAt).toBe(2000)
  })

  it('sets savedAt when the doc has no stamp and lastEditAt is a number', () => {
    const doc = docWith()
    stampDocForSave(doc, 1500)
    expect(doc.savedAt).toBe(1500)
  })

  it('never lowers savedAt when lastEditAt is older than the stamp', () => {
    const doc = docWith(3000)
    stampDocForSave(doc, 2000)
    expect(doc.savedAt).toBe(3000)
  })

  it('leaves savedAt untouched when lastEditAt is null/undefined — the laundering case', () => {
    // A window that never edited the doc must not mint a fresh stamp at
    // serialization time, or 2-hour-old content gets re-labeled as newest.
    const doc = docWith(1000)
    stampDocForSave(doc, null)
    expect(doc.savedAt).toBe(1000)
    stampDocForSave(doc, undefined)
    expect(doc.savedAt).toBe(1000)

    const unstamped = docWith()
    stampDocForSave(unstamped, undefined)
    expect(unstamped.savedAt).toBeUndefined()
  })
})
