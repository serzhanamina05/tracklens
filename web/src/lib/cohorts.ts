import type { DecodedOverview } from './overview'

export function genreCohorts(data: DecodedOverview, a: number, b: number) {
  const histograms = Array.from({ length: 3 }, () => Array<number>(101).fill(0))
  for (const combo of data.combos) {
    const left = combo.genres.includes(a)
    const right = combo.genres.includes(b)
    if (!left && !right) continue
    const histogram = histograms[left && right ? 1 : left ? 0 : 2]
    for (const score of combo.pops) histogram[score]++
  }
  return histograms.map((histogram) => ({ histogram, n: histogram.reduce((sum, count) => sum + count, 0) }))
}

/** P(A > B) with half credit for ties, calculated from score frequencies. */
export function winProbability(a: number[], b: number[]): number | null {
  const nA = a.reduce((sum, count) => sum + count, 0)
  const nB = b.reduce((sum, count) => sum + count, 0)
  if (!nA || !nB) return null
  let below = 0
  let wins = 0
  for (let score = 0; score < a.length; score++) {
    wins += a[score] * (below + b[score] / 2)
    below += b[score]
  }
  return wins / (nA * nB)
}
