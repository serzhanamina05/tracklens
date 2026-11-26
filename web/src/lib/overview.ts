// Aggregate selectors for the Overview. Inputs are the published overview.json;
// nothing here needs track-level data.
import type { OverviewDoc, SumFeature } from './types'

export interface DecodedCombo {
  genres: number[]
  pops: Uint8Array
  dbins: Uint16Array
}

export interface DecodedOverview {
  doc: OverviewDoc
  combos: DecodedCombo[]
}

/** Inverse of pipeline/tracklens/aggregates.py:encode_cells. */
export function decodeCells(cells: number[]): { pops: number[]; dbins: number[] } {
  const pops: number[] = []
  const dbins: number[] = []
  let i = 0
  while (i < cells.length) {
    const p = cells[i]
    const k = cells[i + 1]
    let d = 0
    for (let j = 0; j < k; j++) {
      d = j === 0 ? cells[i + 2] : d + cells[i + 2 + j]
      pops.push(p)
      dbins.push(d)
    }
    i += 2 + k
  }
  return { pops, dbins }
}

export function decodeOverview(doc: OverviewDoc): DecodedOverview {
  const combos = doc.combos.map((c) => {
    const { pops, dbins } = decodeCells(c.cells)
    if (pops.length !== c.n) throw new Error('overview.json: combo cell count mismatch')
    return { genres: c.g, pops: Uint8Array.from(pops), dbins: Uint16Array.from(dbins) }
  })
  return { doc, combos }
}

export interface Filters {
  genres: number[] // empty = all genres
  popMin: number
  popMax: number
}

export interface UniqueSummary {
  tracks: number
  popHist: number[] // index = popularity score 0..100
  durHist: number[] // index = duration bin
  medianPopularity: number | null
  medianDurationS: number | null
  genresWithTracks: number
}

/** Exact median of integer values given as a histogram (index = value). */
export function medianFromCounts(counts: ArrayLike<number>): number | null {
  let total = 0
  for (let i = 0; i < counts.length; i++) total += counts[i]
  if (total === 0) return null
  const at = (rank: number) => {
    let cum = 0
    for (let i = 0; i < counts.length; i++) {
      cum += counts[i]
      if (cum >= rank) return i
    }
    return counts.length - 1
  }
  if (total % 2 === 1) return at((total + 1) / 2)
  return (at(total / 2) + at(total / 2 + 1)) / 2
}

/** Median from fixed-width bins, linearly interpolated inside the median bin. */
export function medianFromBins(counts: ArrayLike<number>, width: number): number | null {
  let total = 0
  for (let i = 0; i < counts.length; i++) total += counts[i]
  if (total === 0) return null
  const half = total / 2
  let cum = 0
  for (let i = 0; i < counts.length; i++) {
    if (cum + counts[i] >= half && counts[i] > 0) return (i + (half - cum) / counts[i]) * width
    cum += counts[i]
  }
  return null
}

export function summariseUnique(dec: DecodedOverview, f: Filters): UniqueSummary {
  const sel = f.genres.length ? new Set(f.genres) : null
  const popHist = new Array<number>(101).fill(0)
  const durHist = new Array<number>(dec.doc.durationMaxBin + 1).fill(0)
  let tracks = 0
  for (const c of dec.combos) {
    if (sel && !c.genres.some((g) => sel.has(g))) continue
    for (let i = 0; i < c.pops.length; i++) {
      const p = c.pops[i]
      if (p < f.popMin || p > f.popMax) continue
      tracks++
      popHist[p]++
      durHist[c.dbins[i]]++
    }
  }
  const candidates = f.genres.length ? f.genres : dec.doc.genres.map((_, i) => i)
  const genresWithTracks = candidates.filter((g) => genreStats(dec.doc, g, f.popMin, f.popMax).n > 0).length
  return {
    tracks,
    popHist,
    durHist,
    medianPopularity: medianFromCounts(popHist),
    medianDurationS: medianFromBins(durHist, dec.doc.durationBinSeconds),
    genresWithTracks,
  }
}

export interface Bucket {
  label: string
  lo: number
  hi: number
  n: number
}

/** Zero gets its own bucket; then 1-5, 6-10, ..., 96-100. */
export function popularityBuckets(popHist: number[]): Bucket[] {
  const out: Bucket[] = [{ label: '0', lo: 0, hi: 0, n: popHist[0] }]
  for (let lo = 1; lo <= 96; lo += 5) {
    const hi = lo + 4
    let n = 0
    for (let p = lo; p <= hi; p++) n += popHist[p]
    out.push({ label: `${lo}–${hi}`, lo, hi, n })
  }
  return out
}

export interface GenreStat {
  genre: number
  name: string
  n: number
  medianPopularity: number | null
  zeroShare: number | null
  means: Record<SumFeature, number | null>
}

const SUM_KEYS: SumFeature[] = [
  'danceability',
  'energy',
  'speechiness',
  'acousticness',
  'instrumentalness',
  'liveness',
  'valence',
  'tempo',
  'loudness',
  'duration_s',
  'explicit',
]

/** Membership-level statistics for one genre within a popularity range. */
export function genreStats(doc: OverviewDoc, g: number, popMin: number, popMax: number): GenreStat {
  const pops = doc.genrePop.pops[g]
  const ns = doc.genrePop.n[g]
  const hist = new Array<number>(101).fill(0)
  const sums: Record<string, number> = {}
  for (const k of SUM_KEYS) sums[k] = 0
  let n = 0
  for (let i = 0; i < pops.length; i++) {
    const p = pops[i]
    if (p < popMin || p > popMax) continue
    n += ns[i]
    hist[p] += ns[i]
    for (const k of SUM_KEYS) sums[k] += doc.genrePop.sums[k][g][i]
  }
  const means = {} as Record<SumFeature, number | null>
  for (const k of SUM_KEYS) means[k] = n ? sums[k] / n : null
  return {
    genre: g,
    name: doc.genres[g],
    n,
    medianPopularity: medianFromCounts(hist),
    zeroShare: n ? hist[0] / n : null,
    means,
  }
}
