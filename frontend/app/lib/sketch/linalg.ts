// Dense Gaussian elimination with partial pivoting. Solves A x = b.
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]!]) // augmented
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r
    if (Math.abs(M[piv]![col]!) < 1e-12) return null
    ;[M[col], M[piv]] = [M[piv]!, M[col]!]
    const d = M[col]![col]!
    for (let c = col; c <= n; c++) M[col]![c]! /= d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r]![col]!
      if (f === 0) continue
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!
    }
  }
  return M.map(row => row[n]!)
}
