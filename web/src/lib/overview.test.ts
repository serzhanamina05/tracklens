import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeCells, decodeOverview, genreStats, medianFromBins, medianFromCounts, popularityBuckets, summariseUnique } from './overview'
import { genreCohorts, winProbability } from './cohorts'
import type { GenresDoc, OverviewDoc } from './types'

const pub = resolve(__dirname, '../../public/data')
const doc = JSON.parse(readFileSync(resolve(pub, 'overview.json'), 'utf8')) as OverviewDoc
const genres = JSON.parse(readFileSync(resolve(pub, 'genres.json'), 'utf8')) as GenresDoc
const dec = decodeOverview(doc)
const all = { genres: [], popMin: 0, popMax: 100 }

describe('medians', () => {
  it('handles odd, even and empty histograms', () => {
    expect(medianFromCounts([0, 1, 1, 1])).toBe(2)
    expect(medianFromCounts([1, 0, 0, 1])).toBe(1.5)
    expect(medianFromCounts([0, 0])).toBeNull()
    expect(medianFromBins([2, 2], 10)).toBe(10)
    expect(medianFromBins([], 5)).toBeNull()
  })
})

describe('cell decoding', () => {
  it('reverses the delta encoding', () => {
    // pop 0: bins 10,10 ; pop 5: bins 38,40,40
    expect(decodeCells([0, 2, 10, 0, 5, 3, 38, 2, 0])).toEqual({ pops: [0, 0, 5, 5, 5], dbins: [10, 10, 38, 40, 40] })
  })
})

describe('unique-track summary', () => {
  const s = summariseUnique(dec, all)
  it('counts every canonical track exactly once', () => {
    expect(s.tracks).toBe(doc.uniqueTracks)
    expect(s.tracks).toBe(89741)
    expect(s.genresWithTracks).toBe(114)
  })
  it('matches the pipeline median popularity for unique tracks', () => {
    expect(s.medianPopularity).toBe(genres.overall.popularity.median)
    expect(s.popHist[0]).toBeGreaterThan(9000)
  })
  it('approximates median duration within one 5-second bin', () => {
    expect(Math.abs(s.medianDurationS! - genres.overall.durationMinutes.median * 60)).toBeLessThan(doc.durationBinSeconds)
  })
  it('deduplicates tracks shared by several selected genres', () => {
    const a = doc.genres.indexOf('singer-songwriter')
    const b = doc.genres.indexOf('songwriter')
    const both = summariseUnique(dec, { genres: [a, b], popMin: 0, popMax: 100 }).tracks
    const sa = genreStats(doc, a, 0, 100).n
    const sb = genreStats(doc, b, 0, 100).n
    expect(both).toBeLessThan(sa + sb)
    expect(both).toBeGreaterThanOrEqual(Math.max(sa, sb))
  })
  it('applies the popularity filter and handles empty selections', () => {
    const zero = summariseUnique(dec, { genres: [], popMin: 0, popMax: 0 })
    expect(zero.tracks).toBe(s.popHist[0])
    expect(zero.medianPopularity).toBe(0)
    const empty = doc.genres.findIndex((_, g) => genreStats(doc, g, 99, 100).n === 0)
    expect(empty).toBeGreaterThanOrEqual(0)
    const none = summariseUnique(dec, { genres: [empty], popMin: 99, popMax: 100 })
    expect(none.tracks).toBe(0)
    expect(none.medianPopularity).toBeNull()
    expect(none.genresWithTracks).toBe(0)
  })
  it('keeps zero in its own histogram bucket', () => {
    const b = popularityBuckets(s.popHist)
    expect(b[0]).toMatchObject({ label: '0', n: s.popHist[0] })
    expect(b).toHaveLength(21)
    expect(b.reduce((a, x) => a + x.n, 0)).toBe(s.tracks)
  })
})

describe('genre statistics (membership denominator)', () => {
  it('match the pipeline per-genre profile', () => {
    for (const g of genres.genres) {
      const st = genreStats(doc, doc.genres.indexOf(g.name), 0, 100)
      expect(st.n).toBe(g.tracks)
      expect(st.medianPopularity).toBe(g.popularity.median)
      expect(st.zeroShare).toBeCloseTo(g.popularity.zeroShare, 3)
      expect(st.means.energy!).toBeCloseTo(g.features.energy.mean, 2)
      expect(st.means.tempo!).toBeCloseTo(g.features.tempo.mean, 1)
    }
  })
})


describe('genre comparison cohorts', () => {
  const cohorts = (a: string, b: string) => genreCohorts(dec, doc.genres.indexOf(a), doc.genres.indexOf(b))

  it('partitions overlapping genres without counting any track twice', () => {
    const [a, shared, b] = cohorts('indie', 'indie-pop')
    expect(shared.n).toBe(579)
    expect(a.n + shared.n + b.n).toBe(summariseUnique(dec, {
      ...all, genres: ['indie', 'indie-pop'].map((name) => doc.genres.indexOf(name)),
    }).tracks)
    expect(cohorts('indie-pop', 'indie')).toEqual([b, shared, a])
  })

  it('handles two labels with exactly the same tracks', () => {
    const [a, shared, b] = cohorts('songwriter', 'singer-songwriter')
    expect([a.n, shared.n, b.n]).toEqual([0, 1000, 0])
    expect(winProbability(a.histogram, b.histogram)).toBeNull()
  })

  it('calculates score wins with half credit for ties and includes zero scores', () => {
    expect(winProbability([1, 1, 0], [1, 0, 0])).toBe(0.75)
    expect(winProbability([1, 0, 0], [1, 1, 0])).toBe(0.25)
    expect(winProbability([0, 2], [0, 7])).toBe(0.5)
  })
})
