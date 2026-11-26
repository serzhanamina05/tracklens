// Plain-language explanations of audio-feature similarity.
import { fmtNum, label } from './format'
import type { SimilarResult } from './trackProtocol'
import type { GenreProfile, ProfileFeature, SimilaritySpec } from './types'

const short = (f: string) => label(f).replace(/ \(.*\)/, '').toLowerCase()
const fmtVal = (f: string, v: number) => (f === 'tempo' || f === 'loudness' ? fmtNum(v, 0) : fmtNum(v, 2))

export function explainNeighbor(n: SimilarResult[number]): string {
  const shared = n.closest
    .map((c) => `${c.level === 'typical' ? 'similar' : c.level} ${short(c.feature)} (${fmtVal(c.feature, c.query)} vs ${fmtVal(c.feature, c.other)})`)
    .join(' and ')
  const lead = n.closest.every((c) => c.level !== 'typical') ? `Both ${shared}` : shared.charAt(0).toUpperCase() + shared.slice(1)
  const diff = n.differs
    ? `; differs most in ${short(n.differs.feature)} (${fmtVal(n.differs.feature, n.differs.query)} vs ${fmtVal(n.differs.feature, n.differs.other)})`
    : '; no feature differs by more than half a standard deviation'
  return `${lead}${diff}. Distance ${fmtNum(n.distance, 2)}.`
}

export function centroidExplanation(a: GenreProfile, b: GenreProfile, sim: SimilaritySpec): string {
  const rows = sim.features.map((f, j) => ({ f: f as ProfileFeature, za: a.centroid[j], dz: Math.abs(a.centroid[j] - b.centroid[j]) }))
  const agreeing = rows.filter((r) => r.dz < 0.35).sort((x, y) => Math.abs(y.za) - Math.abs(x.za) || x.dz - y.dz)
  const picked = (agreeing.length ? agreeing : rows.slice().sort((x, y) => x.dz - y.dz)).slice(0, 2)
  const level = (z: number) => (z > 0.5 ? 'high' : z < -0.5 ? 'low' : 'similar')
  const shared = picked.map((r) => `${level(r.za)} ${short(r.f)} (${fmtVal(r.f, a.features[r.f].mean)} vs ${fmtVal(r.f, b.features[r.f].mean)})`).join(' and ')
  const far = rows.slice().sort((x, y) => y.dz - x.dz)[0]
  const lead = picked.every((r) => level(r.za) !== 'similar') ? `Both ${shared}` : shared.charAt(0).toUpperCase() + shared.slice(1)
  return `${lead}; differs most in ${short(far.f)} (${fmtVal(far.f, a.features[far.f].mean)} vs ${fmtVal(far.f, b.features[far.f].mean)}).`
}
