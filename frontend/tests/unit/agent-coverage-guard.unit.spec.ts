import { describe, it, expect } from 'vitest'
import { ACTION_CATALOG } from '~/data/action-catalog'
import { AGENT_CAPABILITIES, AGENT_EXCLUDED } from '~/lib/agent/capabilities'

/**
 * Coverage guard: every node surfaced in the Actions panel as an edit/enhance
 * use-case must have an explicit agent story — either an AGENT_CAPABILITIES
 * entry (with intents, so verbs route to it) or an AGENT_EXCLUDED entry with
 * a human-readable reason. Adding a panel node without deciding its agent
 * visibility fails here instead of silently rotting.
 * Companion doc: docs/agent/edit-verb-coverage.md
 */

const capTypes = new Set(AGENT_CAPABILITIES.map(c => c.nodeType))

describe('agent coverage guard', () => {
  const relevant = Object.entries(ACTION_CATALOG)
    .filter(([, e]) => e.intent === 'edit' || e.intent === 'enhance')

  it('covers a non-trivial set (sanity: filter is not vacuous)', () => {
    expect(relevant.length).toBeGreaterThan(10)
  })

  for (const [nodeType, entry] of Object.entries(ACTION_CATALOG)) {
    if (entry.intent !== 'edit' && entry.intent !== 'enhance') continue
    it(`${nodeType} ("${entry.useCase}") has an agent-visibility decision`, () => {
      const covered = capTypes.has(nodeType) || nodeType in AGENT_EXCLUDED
      expect(covered,
        `${nodeType} is in the Actions panel but has no agent story. ` +
        `Either add an AGENT_CAPABILITIES entry with intents (app/lib/agent/capabilities.ts) ` +
        `or add it to AGENT_EXCLUDED with a reason.`).toBe(true)
    })
  }

  it('AGENT_EXCLUDED entries carry a reason and are not ALSO capabilities', () => {
    for (const [nodeType, reason] of Object.entries(AGENT_EXCLUDED)) {
      expect(reason.trim().length, `${nodeType} exclusion needs a reason`).toBeGreaterThan(10)
      expect(capTypes.has(nodeType), `${nodeType} is both excluded and a capability — pick one`).toBe(false)
    }
  })
})
