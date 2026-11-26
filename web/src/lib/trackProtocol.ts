import type { Density, FilterFeature, Neighbor, TrackQuery } from './tracks'

export interface TrackRow {
  index: number
  id: string
  name: string
  artists: string
  album: string
  popularity: number
  genres: string[]
  duration_ms: number
  explicit: number
  key: number
  mode: number
  time_signature: number
  split: string
  valid: boolean
  features: Record<FilterFeature, number>
}

export type WorkerRequest =
  | { id: number; type: 'init'; base: string }
  | { id: number; type: 'query'; query: TrackQuery; plot: { x: FilterFeature; y: FilterFeature } }
  | { id: number; type: 'detail'; index: number }
  | { id: number; type: 'similar'; index: number; k: number }

export type WorkerResponse = { id: number } & ({ ok: true; result: unknown } | { ok: false; error: string })

export interface InitResult {
  count: number
  domains: Record<FilterFeature, [number, number]>
}
export interface QueryResult {
  total: number
  rows: TrackRow[]
  medianPopularity: number | null
  zeroShare: number | null
  density: Density
}
export type SimilarResult = (Neighbor & { track: TrackRow })[]

type Body<T> = T extends unknown ? Omit<T, 'id'> : never

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let ready: Promise<InitResult> | null = null

function call<T>(body: Body<WorkerRequest>): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./tracks.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok) p.resolve(e.data.result)
      else p.reject(new Error(e.data.error))
    }
  }
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    worker!.postMessage({ id, ...body })
  })
}

export function initTracks(): Promise<InitResult> {
  if (!ready) {
    ready = call<InitResult>({ type: 'init', base: import.meta.env.BASE_URL })
    ready.catch(() => (ready = null))
  }
  return ready
}

export async function queryTracks(query: TrackQuery, plot: { x: FilterFeature; y: FilterFeature }): Promise<QueryResult> {
  await initTracks()
  return call<QueryResult>({ type: 'query', query, plot })
}

export async function trackDetail(index: number): Promise<TrackRow> {
  await initTracks()
  return call<TrackRow>({ type: 'detail', index })
}

export async function similarTracks(index: number, k = 10): Promise<SimilarResult> {
  await initTracks()
  return call<SimilarResult>({ type: 'similar', index, k })
}
