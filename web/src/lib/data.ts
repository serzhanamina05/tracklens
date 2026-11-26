import type { GenresDoc, MetaDoc, ModelEval, ModelSpec, OverviewDoc, SimilaritySpec } from './types'

export const DATA_MODE: 'full' | 'aggregate' = __DATA_MODE__
export const FULL_MODE = DATA_MODE === 'full'

export function dataUrl(name: string): string {
  return `${import.meta.env.BASE_URL}data/${name}`
}

const cache = new Map<string, Promise<unknown>>()

export function loadJson<T>(name: string): Promise<T> {
  let p = cache.get(name)
  if (!p) {
    p = fetch(dataUrl(name)).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${name} (HTTP ${r.status})`)
      return r.json()
    })
    p.catch(() => cache.delete(name))
    cache.set(name, p)
  }
  return p as Promise<T>
}

export const loadOverview = () => loadJson<OverviewDoc>('overview.json')
export const loadGenres = () => loadJson<GenresDoc>('genres.json')
export const loadMeta = () => loadJson<MetaDoc>('meta.json')
export const loadModel = () => loadJson<ModelSpec>('model.json')
export const loadModelEval = () => loadJson<ModelEval>('model-eval.json')
export const loadSimilarity = () => loadJson<SimilaritySpec>('similarity.json')
