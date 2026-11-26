/// <reference lib="webworker" />
// Track-level search, filtering, density binning and similarity search, kept
// off the main thread. Only used in local full-data mode.
import type { LocalTracks, SimilaritySpec } from './types'
import { density, filterTracks, FILTER_FEATURES, indexTracks, medianOf, nearest, sortIndices, zMatrix, type FilterFeature, type Indexed, type TrackQuery } from './tracks'
import type { WorkerRequest, TrackRow } from './trackProtocol'

let table: Indexed | null = null
let Z: Float64Array | null = null
let spec: SimilaritySpec | null = null
let domains: Record<FilterFeature, [number, number]> | null = null

async function init(base: string) {
  const [t, s] = await Promise.all([
    fetch(`${base}data/full/tracks.json`).then((r) => {
      if (!r.ok) throw new Error(`tracks.json HTTP ${r.status}`)
      return r.json() as Promise<LocalTracks>
    }),
    fetch(`${base}data/similarity.json`).then((r) => r.json() as Promise<SimilaritySpec>),
  ])
  table = indexTracks(t)
  spec = s
  Z = zMatrix(t, s)
  domains = {} as Record<FilterFeature, [number, number]>
  for (const f of FILTER_FEATURES) {
    let lo = Infinity
    let hi = -Infinity
    for (const v of t[f]) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    domains[f] = f === 'tempo' || f === 'loudness' ? [Math.floor(lo), Math.ceil(hi)] : [0, 1]
  }
  return { count: t.count, domains }
}

function row(i: number): TrackRow {
  const t = table!
  return {
    index: i,
    id: t.id[i],
    name: t.name[i],
    artists: t.artists[i].replaceAll(';', ', '),
    album: t.album[i],
    popularity: t.popularity[i],
    genres: t.genreIdx[i].map((g) => t.genres[g]),
    duration_ms: t.duration_ms[i],
    explicit: t.explicit[i],
    key: t.key[i],
    mode: t.mode[i],
    time_signature: t.time_signature[i],
    split: t.split[i],
    valid: t.valid[i] === 1,
    features: Object.fromEntries(FILTER_FEATURES.map((f) => [f, t[f][i]])) as Record<FilterFeature, number>,
  }
}

function query(q: TrackQuery, plot: { x: FilterFeature; y: FilterFeature }) {
  const t = table!
  const idx = filterTracks(t, q)
  const sorted = sortIndices(t, idx, q.sort)
  const start = q.page * q.pageSize
  return {
    total: idx.length,
    rows: sorted.slice(start, start + q.pageSize).map(row),
    medianPopularity: medianOf(idx.map((i) => t.popularity[i])),
    zeroShare: idx.length ? idx.filter((i) => t.popularity[i] === 0).length / idx.length : null,
    density: density(t, idx, plot.x, plot.y, domains!),
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  const reply = (body: { ok: true; result: unknown } | { ok: false; error: string }) => (self as unknown as Worker).postMessage({ id: msg.id, ...body })
  try {
    switch (msg.type) {
      case 'init':
        reply({ ok: true, result: await init(msg.base) })
        break
      case 'query':
        reply({ ok: true, result: query(msg.query, msg.plot) })
        break
      case 'detail':
        reply({ ok: true, result: row(msg.index) })
        break
      case 'similar': {
        const res = nearest(table!, spec!, Z!, msg.index, msg.k)
        reply({ ok: true, result: res.map((n) => ({ ...n, track: row(n.index) })) })
        break
      }
    }
  } catch (err) {
    reply({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
