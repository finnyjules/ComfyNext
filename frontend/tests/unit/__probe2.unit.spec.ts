import { describe, it } from 'vitest'
import { AGENT_CAPABILITIES, capabilityBoosts, capabilityKeywords } from '~/lib/agent/capabilities'
import { scoreNode, tokenize } from '~/lib/nodeMatch'

const CAP_NODES = AGENT_CAPABILITIES.map(c => ({ name: c.nodeType, displayName: c.title, description: c.summary, category: c.kind }))
const keywords = { ...capabilityKeywords() }
const boosts = { ...capabilityBoosts() }

describe('probe2', () => {
  it('detail', () => {
    const fs = require('node:fs')
    const tokens = tokenize('blue to purple gradient background')
    const lines: string[] = []
    for (const node of CAP_NODES) {
      const s = scoreNode(node, tokens, keywords[node.name] ?? [])
      const b = boosts[node.name] ?? 0
      if (s + b > 0) lines.push(`${node.name}: base=${s} boost=${b} total=${s+b}`)
    }
    lines.sort((a,b) => parseFloat(b.split('total=')[1]) - parseFloat(a.split('total=')[1]))
    fs.writeFileSync('/tmp/probe2.txt', lines.join('\n'))
  })
})
