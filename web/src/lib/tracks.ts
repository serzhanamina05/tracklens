// Pure track-level functions used by the worker (local full-data mode only).
import type { LocalTracks, SimilaritySpec } from './types'

export function normalise(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export const FILTER_FEATURES = [
  'danceability',
  'energy',
  'speechiness',
  'acousticness',
  'instrumentalness',
  'liveness',
  'valence',
  'tempo',
  'loudness',
] as const
export type FilterFeature = (typeof FILTER_FEATURES)[number]

export type SortKey = 'popularity' | 'name' | 'artists' | 'duration_ms' | FilterFeature
export interface TrackQuery {
  text: string
  genres: number[]
  popMin: number
  popMax: number
  features: Partial<Record<FilterFeature, [number, number]>>
  sort: { key: SortKey; dir: 'asc' | 'desc' }
  page: number
  pageSize: number
}

export interface Indexed extends LocalTracks {
  haystack: string[]
  nameKey: string[]
}

export function indexTracks(t: LocalTracks): Indexed {
  const haystack = new Array<string>(t.count)
  const nameKey = new Array<string>(t.count)
  for (let i = 0; i < t.count; i++) {
    haystack[i] = normalise(`${t.name[i]} ␟ ${t.artists[i]} ␟ ${t.album[i]}`)
    nameKey[i] = `${normalise(t.artists[i])}␟${normalise(t.name[i])}`
  }
  return { ...t, haystack, nameKey }
}

/** Indices matching every filter. Text search is case- and accent-insensitive;
 *  every whitespace-separated term must appear in the title, artist or album. */
export function filterTracks(t: Indexed, q: Omit<TrackQuery, 'sort' | 'page' | 'pageSize'>): number[] {
  const terms = normalise(q.text).split(' ').filter(Boolean)
  const sel = q.genres.length ? new Set(q.genres) : null
  const ranges = Object.entries(q.features) as [FilterFeature, [number, number]][]
  const out: number[] = []
  for (let i = 0; i < t.count; i++) {
    const p = t.popularity[i]
    if (p < q.popMin || p > q.popMax) continue
    if (sel && !t.genreIdx[i].some((g) => sel.has(g))) continue
    let ok = true
    for (const [f, [lo, hi]] of ranges) {
      const v = t[f][i]
      if (v < lo || v > hi) {
        ok = false
        break
      }
    }
    if (!ok) continue
    if (terms.length && !terms.every((term) => t.haystack[i].includes(term))) continue
    out.push(i)
  }
  return out
}

export function sortIndices(t: Indexed, idx: number[], sort: TrackQuery['sort']): number[] {
  const dir = sort.dir === 'asc' ? 1 : -1
  const key = sort.key
  const copy = idx.slice()
  if (key === 'name' || key === 'artists') {
    const col = t[key]
    copy.sort((a, b) => dir * col[a].localeCompare(col[b], 'en', { sensitivity: 'base' }) || a - b)
  } else {
    const col = t[key] as number[]
    copy.sort((a, b) => dir * (col[a] - col[b]) || a - b)
  }
  return copy
}

export function medianOf(values: number[]): number | null {
  if (!values.length) return null
  const s = values.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface Density {
  x: FilterFeature
  y: FilterFeature
  xDomain: [number, number]
  yDomain: [number, number]
  nx: number
  ny: number
  counts: number[] // row-major, ny rows of nx
  plotted: number
}

export function density(t: Indexed, idx: number[], x: FilterFeature, y: FilterFeature, domains: Record<FilterFeature, [number, number]>, nx = 30, ny = 30): Density {
  const [x0, x1] = domains[x]
  const [y0, y1] = domains[y]
  const counts = new Array<number>(nx * ny).fill(0)
  for (const i of idx) {
    const cx = Math.min(nx - 1, Math.max(0, Math.floor(((t[x][i] - x0) / (x1 - x0)) * nx)))
    const cy = Math.min(ny - 1, Math.max(0, Math.floor(((t[y][i] - y0) / (y1 - y0)) * ny)))
    counts[cy * nx + cx]++
  }
  return { x, y, xDomain: [x0, x1], yDomain: [y0, y1], nx, ny, counts, plotted: idx.length }
}

// --------------------------------------------------------------------------
// Similarity
// --------------------------------------------------------------------------
export function zMatrix(t: LocalTracks, spec: SimilaritySpec): Float64Array {
  const d = spec.features.length
  const Z = new Float64Array(t.count * d)
  for (let i = 0; i < t.count; i++) {
    for (let j = 0; j < d; j++) {
      const col = (t as unknown as Record<string, number[]>)[spec.features[j]]
      Z[i * d + j] = (col[i] - spec.mean[j]) / spec.scale[j]
    }
  }
  return Z
}

export interface SharedTrait {
  feature: string
  level: 'high' | 'low' | 'typical'
  query: number
  other: number
}

export interface Neighbor {
  index: number
  distance: number
  closest: SharedTrait[]
  differs: { feature: string; query: number; other: number } | null
}

/** Explain a match from feature differences. Prefers features on which the two
 *  tracks agree (|dz| < 0.35) and the query is distinctive (large |z|), so the
 *  text names what the tracks share rather than features nearly every track
 *  shares (e.g. instrumentalness near 0). */
export function explain(t: LocalTracks, spec: SimilaritySpec, Z: Float64Array, q: number, o: number): Pick<Neighbor, 'closest' | 'differs'> {
  const d = spec.features.length
  const cols = t as unknown as Record<string, number[]>
  const rows = spec.features.map((f, j) => ({ f, zq: Z[q * d + j], dz: Math.abs(Z[q * d + j] - Z[o * d + j]) }))
  const agreeing = rows.filter((r) => r.dz < 0.35).sort((a, b) => Math.abs(b.zq) - Math.abs(a.zq) || a.dz - b.dz)
  const picked = (agreeing.length ? agreeing : rows.slice().sort((a, b) => a.dz - b.dz)).slice(0, 2)
  const worst = rows.slice().sort((a, b) => b.dz - a.dz)[0]
  return {
    closest: picked.map((r) => ({
      feature: r.f,
      level: r.zq > 0.5 ? 'high' : r.zq < -0.5 ? 'low' : 'typical',
      query: cols[r.f][q],
      other: cols[r.f][o],
    })),
    differs: worst.dz > 0.5 ? { feature: worst.f, query: cols[worst.f][q], other: cols[worst.f][o] } : null,
  }
}

/** k nearest tracks by Euclidean distance on z-scored audio features.
 *  Excludes the query, its duplicate-recording group and invalid rows, and
 *  keeps only the closest ID per (artist, title) and per duplicate group. */
export function nearest(t: Indexed, spec: SimilaritySpec, Z: Float64Array, q: number, k = 10): Neighbor[] {
  const d = spec.features.length
  const best: { i: number; dist: number }[] = []
  const limit = k * 8 // head-room for de-duplication
  let worst = Infinity
  for (let i = 0; i < t.count; i++) {
    if (i === q || !t.valid[i] || t.dupGroup[i] === t.dupGroup[q] || t.nameKey[i] === t.nameKey[q]) continue
    let s = 0
    for (let j = 0; j < d; j++) {
      const diff = Z[i * d + j] - Z[q * d + j]
      s += diff * diff
      if (s > worst) break
    }
    if (best.length < limit || s < worst) {
      best.push({ i, dist: s })
      if (best.length > limit) {
        best.sort((a, b) => a.dist - b.dist || a.i - b.i)
        best.length = limit
      }
      if (best.length === limit) worst = Math.max(...best.map((b) => b.dist))
    }
  }
  best.sort((a, b) => a.dist - b.dist || a.i - b.i)
  const seenName = new Set<string>()
  const seenGroup = new Set<number>()
  const out: Neighbor[] = []
  for (const b of best) {
    if (seenName.has(t.nameKey[b.i]) || seenGroup.has(t.dupGroup[b.i])) continue
    seenName.add(t.nameKey[b.i])
    seenGroup.add(t.dupGroup[b.i])
    out.push({ index: b.i, distance: Math.sqrt(b.dist), ...explain(t, spec, Z, q, b.i) })
    if (out.length === k) break
  }
  return out
}
