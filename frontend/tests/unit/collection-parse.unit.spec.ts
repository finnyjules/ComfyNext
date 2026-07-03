import { describe, it, expect } from 'vitest'
import { inferType, parseDelimited, importTable } from '~/lib/collection/parse'
import { createCollection } from '~/lib/collection/model'

describe('inferType', () => {
  it('detects hex colors', () => {
    expect(inferType(['#fff', '#0C447C'])).toBe('color')
  })
  it('detects numbers', () => {
    expect(inferType(['1', '2.5', '-3'])).toBe('number')
  })
  it('detects image urls', () => {
    expect(inferType(['https://x.com/a.png', '/view?filename=b.jpg'])).toBe('image')
  })
  it('falls back to text; ignores empties', () => {
    expect(inferType(['France', ''])).toBe('text')
    expect(inferType([])).toBe('text')
  })
})

describe('parseDelimited', () => {
  it('parses comma CSV with quoted cells', () => {
    expect(parseDelimited('a,"b, c",d\n1,2,3')).toEqual([['a', 'b, c', 'd'], ['1', '2', '3']])
  })
  it('prefers tabs when present (spreadsheet paste)', () => {
    expect(parseDelimited('a\tb,c\n1\t2')).toEqual([['a', 'b,c'], ['1', '2']])
  })
  it('handles escaped quotes and CRLF', () => {
    expect(parseDelimited('"say ""hi""",x\r\n1,2')).toEqual([['say "hi"', 'x'], ['1', '2']])
  })
})

describe('importTable', () => {
  it('builds columns from header with inferred types and fills rows', () => {
    const c = createCollection('t')
    importTable(c, 'team,primary\nFrance,#0C447C\nBrazil,#639922')
    expect(c.columns.map(x => x.key)).toEqual(['team', 'primary'])
    expect(c.columns[1].type).toBe('color')
    expect(c.rows).toHaveLength(2)
    expect(c.rows[0].values.team).toBe('France')
    expect(c.rows[1].values.primary).toBe('#639922')
  })
  it('coerces number cells to numbers', () => {
    const c = createCollection('t')
    importTable(c, 'n\n1\n2.5')
    expect(c.rows[1].values.n).toBe(2.5)
  })
  it('is a no-op on empty or whitespace-only input', () => {
    const c = createCollection('t')
    importTable(c, '')
    importTable(c, '   \n  ')
    expect(c.columns).toEqual([])
    expect(c.rows).toEqual([])
  })
})
