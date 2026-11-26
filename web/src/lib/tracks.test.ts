import { describe, expect, it } from 'vitest'
import { filterTracks, indexTracks, nearest, normalise, sortIndices, zMatrix } from './tracks'
import type { LocalTracks, SimilaritySpec } from './types'

function table(): LocalTracks {
  const rows = [
    { name: 'Café Song', artists: 'Ána', album: 'One', pop: 10, g: [0], e: 0.5, d: 0.5, dup: 0 },
    { name: 'cafe song', artists: 'ana', album: 'Two', pop: 0, g: [1], e: 0.51, d: 0.5, dup: 0 }, // same recording as 0
    { name: 'Other', artists: 'B', album: 'Three', pop: 50, g: [0, 1], e: 0.52, d: 0.52, dup: 2 },
    { name: 'Other', artists: 'B', album: 'Comp', pop: 40, g: [1], e: 0.53, d: 0.52, dup: 3 }, // same title+artist, other group
    { name: 'Far', artists: 'C', album: 'Four', pop: 90, g: [2], e: 0.95, d: 0.1, dup: 4 },
    { name: 'Bad', artists: 'D', album: 'Five', pop: 5, g: [2], e: 0.5, d: 0.5, dup: 5 },
  ]
  const col = <T,>(f: (r: (typeof rows)[number]) => T) => rows.map(f)
  const n = rows.length
  return {
    schemaVersion: 1,
    dataSha256: 'x',
    count: n,
    genres: ['a', 'b', 'c'],
    id: col(() => 'id'),
    name: col((r) => r.name),
    artists: col((r) => r.artists),
    album: col((r) => r.album),
    popularity: col((r) => r.pop),
    genreIdx: col((r) => r.g),
    dupGroup: col((r) => r.dup),
    split: col(() => 'train'),
    valid: [1, 1, 1, 1, 1, 0],
    explicit: new Array(n).fill(0),
    duration_ms: new Array(n).fill(200000),
    key: new Array(n).fill(0),
    mode: new Array(n).fill(1),
    time_signature: new Array(n).fill(4),
    danceability: col((r) => r.d),
    energy: col((r) => r.e),
    speechiness: new Array(n).fill(0.05),
    acousticness: new Array(n).fill(0.1),
    instrumentalness: new Array(n).fill(0),
    liveness: new Array(n).fill(0.1),
    valence: new Array(n).fill(0.5),
    loudness: new Array(n).fill(-6),
    tempo: new Array(n).fill(120),
  }
}

const spec: SimilaritySpec = {
  schemaVersion: 1,
  dataSha256: 'x',
  features: ['danceability', 'energy', 'tempo'],
  scaler: '',
  fittedOn: 0,
  mean: [0.5, 0.5, 120],
  scale: [0.1, 0.1, 10],
  metric: '',
  excluded: [],
}

const base = { text: '', genres: [], popMin: 0, popMax: 100, features: {} }

describe('search and filters', () => {
  const t = indexTracks(table())
  it('normalises case and accents', () => {
    expect(normalise('  CAFÉ   Señor ')).toBe('cafe senor')
  })
  it('matches title, artist or album case-insensitively, all terms required', () => {
    expect(filterTracks(t, { ...base, text: 'CAFE' })).toEqual([0, 1])
    expect(filterTracks(t, { ...base, text: 'ana two' })).toEqual([1])
    expect(filterTracks(t, { ...base, text: 'comp' })).toEqual([3])
    expect(filterTracks(t, { ...base, text: 'nothing matches' })).toEqual([])
  })
  it('combines genre, popularity and feature ranges', () => {
    expect(filterTracks(t, { ...base, genres: [1] })).toEqual([1, 2, 3])
    expect(filterTracks(t, { ...base, genres: [1], popMin: 1 })).toEqual([2, 3])
    expect(filterTracks(t, { ...base, features: { energy: [0.9, 1] } })).toEqual([4])
  })
  it('sorts with a stable tiebreak', () => {
    expect(sortIndices(t, [0, 1, 2, 3, 4], { key: 'popularity', dir: 'desc' })).toEqual([4, 2, 3, 0, 1])
    expect(sortIndices(t, [2, 4, 0], { key: 'name', dir: 'asc' })).toEqual([0, 4, 2])
  })
})

describe('nearest neighbours', () => {
  const t = indexTracks(table())
  const Z = zMatrix(t, spec)
  it('excludes the query, its duplicates and invalid rows, and dedupes results', () => {
    const res = nearest(t, spec, Z, 0, 5)
    const idx = res.map((r) => r.index)
    expect(idx).not.toContain(0)
    expect(idx).not.toContain(1) // same duplicate group as the query
    expect(idx).not.toContain(5) // invalid row
    expect(idx.filter((i) => i === 2 || i === 3)).toHaveLength(1) // same title + artist kept once
    expect(idx[0]).toBe(2)
    expect(res[0].distance).toBeLessThan(res[res.length - 1].distance)
  })
  it('explains the result from feature differences', () => {
    const [first] = nearest(t, spec, Z, 0, 1)
    expect(first.closest.map((c) => c.feature)).toContain('tempo')
    expect(first.closest[0].level).toBe('typical')
    const far = nearest(t, spec, Z, 0, 5).find((r) => r.index === 4)!
    expect(far.differs?.feature).toMatch(/energy|danceability/)
  })
})
