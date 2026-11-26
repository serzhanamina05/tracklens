// Types for the JSON artifacts written by pipeline/build.py.

export const UNIT_FEATURES = [
  'danceability',
  'energy',
  'speechiness',
  'acousticness',
  'instrumentalness',
  'liveness',
  'valence',
] as const
export type UnitFeature = (typeof UNIT_FEATURES)[number]
export type SumFeature = UnitFeature | 'tempo' | 'loudness' | 'duration_s' | 'explicit'
export type ProfileFeature = UnitFeature | 'tempo' | 'loudness'

export interface Versioned {
  schemaVersion: number
  dataSha256: string
  buildId?: string
}

export interface Combo {
  g: number[]
  n: number
  cells: number[]
}

export interface OverviewDoc extends Versioned {
  genres: string[]
  durationBinSeconds: number
  durationMaxBin: number
  uniqueTracks: number
  combos: Combo[]
  genrePop: {
    pops: number[][]
    n: number[][]
    sums: Record<SumFeature, number[][]>
  }
}

export interface Quant {
  q1: number
  median: number
  q3: number
  mean: number
}

export interface GenreProfile {
  name: string
  tracks: number
  sharedTracks: number
  popularity: Quant & { zeroShare: number }
  durationMinutes: Quant
  explicitShare: number
  features: Record<ProfileFeature, Quant>
  modeMajorShare: number
  centroid: number[]
  neighbors: { genre: string; distance: number }[]
}

export interface GenresDoc extends Versioned {
  denominator: string
  overallDenominator: string
  genres: GenreProfile[]
  overall: Omit<GenreProfile, 'name' | 'sharedTracks' | 'modeMajorShare' | 'neighbors'>
}

export interface SimilaritySpec extends Versioned {
  features: string[]
  scaler: string
  fittedOn: number
  mean: number[]
  scale: number[]
  metric: string
  excluded: string[]
}

export interface ValidationRule {
  min: number
  max: number
  integer: boolean
  unit: string
}

interface ModelBase extends Versioned {
  family: 'baseline' | 'ridge' | 'hgb'
  label: string
  features: string[]
  validation: Record<string, ValidationRule>
  clip: [number, number]
  trainedOnRows: number
  defaults: Record<string, number>
}

export interface TreeNodes {
  f: number[]
  t: number[]
  l: number[]
  r: number[]
  v: number[]
}

export type ModelSpec =
  | (ModelBase & { kind: 'constant'; value: number })
  | (ModelBase & {
      kind: 'linear'
      intercept: number
      numeric: { feature: string; mean: number; scale: number; coef: number }[]
      categorical: { feature: string; levels: number[]; coefs: number[] }[]
    })
  | (ModelBase & { kind: 'trees'; baseline: number; trees: TreeNodes[] })

export interface Metrics {
  mae: number
  rmse: number
  r2: number
}

export interface ModelEval extends Versioned {
  selected: string
  selectionRule: string
  baselineValue: number
  test: Metrics
  baselineTest: Metrics
  maeGain: { points: number; interval95: [number, number]; groups: number; replicates: number }
  nonzero: { n: number; mae: number | null; baselineMae: number | null }
  comparison: { family: string; label: string; validation: Metrics; test: Metrics; selected: boolean }[]
  trials: { family: string; label: string; validationMae: number; fitSeconds: number }[]
  testRows: number
  actualVsPredicted: { actualBins: string[]; predictedBinWidth: number; counts: number[][] }
  residuals: { edges: number[]; counts: number[]; mean: number; median: number }
  bands: { band: string; n: number; mae: number; baselineMae: number; meanActual: number; meanPredicted: number }[]
  importance: { method: string; rows: { feature: string; maeIncrease: number; std: number }[] }
  split: {
    rows: { train: number; validation: number; test: number }
    excludedInvalidTracks: number
    testTracksWithTitleInTrain: number
    seed: number
    method: string
  }
  features: string[]
}

export interface MetaDoc extends Versioned {
  profile: {
    rows: number
    unique_track_ids: number
    genres: number
    memberships: number
    missing_values: Record<string, number>
    ids_on_multiple_rows: number
    tracks_in_multiple_genres: number
    max_genres_per_track: number
    zero_popularity_rows: number
    zero_popularity_tracks: number
    zero_popularity_memberships: number
    duplicate_recording_groups: number
    tracks_in_duplicate_recording_groups: number
    zero_tracks_in_duplicate_groups: number
    zero_tracks_with_nonzero_duplicate: number
    tempo_zero_tracks: number
    rules: {
      repeated_track_genre_pairs_dropped: number
      popularity_conflict_ids: number
      popularity_conflict_max_spread: number
      popularity_conflict_ids_with_a_zero_row: number
      model_invalid_tracks: number
    }
  }
  publication: { mode: string; reason: string }
}

/** Track-level columnar file, only present in local full-data mode. */
export interface LocalTracks extends Versioned {
  count: number
  genres: string[]
  id: string[]
  name: string[]
  artists: string[]
  album: string[]
  popularity: number[]
  genreIdx: number[][]
  dupGroup: number[]
  split: string[]
  valid: number[]
  explicit: number[]
  duration_ms: number[]
  key: number[]
  mode: number[]
  time_signature: number[]
  danceability: number[]
  energy: number[]
  speechiness: number[]
  acousticness: number[]
  instrumentalness: number[]
  liveness: number[]
  valence: number[]
  loudness: number[]
  tempo: number[]
}
