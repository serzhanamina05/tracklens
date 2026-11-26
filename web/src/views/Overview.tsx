import * as Plot from '@observablehq/plot'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { COMPARISONS, compareUrl } from '../lib/compareLinks'
import { Chart } from '../components/Chart'
import { cssVar, plotBase, useColorScheme } from '../lib/chartTheme'
import { Empty, ErrorBox, GenrePicker, Loading, PopularityRange, Select, StatCard } from '../components/ui'
import { useAsync } from '../lib/useAsync'
import { loadGenres, loadMeta, loadOverview } from '../lib/data'
import { fmtDuration, fmtInt, fmtNum, fmtPct, label } from '../lib/format'
import { decodeOverview, genreStats, popularityBuckets, summariseUnique, type GenreStat } from '../lib/overview'
import { UNIT_FEATURES, type GenresDoc, type MetaDoc, type SumFeature } from '../lib/types'

const listFmt = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })
const DEFAULT_TRIO = ['classical', 'metal', 'hip-hop']
const SERIES = ['--series-1', '--series-2', '--series-3']

type Metric = 'medianPopularity' | 'zeroShare' | 'n' | SumFeature
const METRICS: { value: Metric; label: string }[] = [
  { value: 'medianPopularity', label: 'Median popularity' },
  { value: 'zeroShare', label: 'Share with popularity 0' },
  { value: 'n', label: 'Tracks (memberships)' },
  ...UNIT_FEATURES.map((f) => ({ value: f as Metric, label: `Mean ${label(f).toLowerCase()}` })),
  { value: 'tempo', label: 'Mean tempo (BPM)' },
  { value: 'loudness', label: 'Mean loudness (dB)' },
  { value: 'duration_s', label: 'Mean duration (min)' },
  { value: 'explicit', label: 'Share explicit' },
]

function metricValue(s: GenreStat, m: Metric): number | null {
  if (m === 'medianPopularity') return s.medianPopularity
  if (m === 'zeroShare') return s.zeroShare
  if (m === 'n') return s.n
  const v = s.means[m]
  return v === null ? null : m === 'duration_s' ? v / 60 : v
}

function formatMetric(m: Metric, v: number | null): string {
  if (v === null) return '—'
  if (m === 'zeroShare' || m === 'explicit') return fmtPct(v)
  if (m === 'n') return fmtInt(v)
  if (m === 'medianPopularity') return fmtNum(v, v % 1 ? 1 : 0)
  if (m === 'tempo' || m === 'loudness') return fmtNum(v, 1)
  if (m === 'duration_s') return fmtDuration(v * 60)
  return fmtNum(v, 3)
}

export default function Overview() {
  const ov = useAsync(loadOverview)
  const gd = useAsync(loadGenres)
  const meta = useAsync(loadMeta)
  if (ov.error || gd.error || meta.error) return <ErrorBox error={(ov.error ?? gd.error ?? meta.error)!} />
  if (!ov.data || !gd.data || !meta.data) return <Loading what="overview data" />
  return <OverviewBody doc={ov.data} genresDoc={gd.data} meta={meta.data} />
}

function OverviewBody({ doc, genresDoc, meta }: { doc: Parameters<typeof decodeOverview>[0]; genresDoc: GenresDoc; meta: MetaDoc }) {
  const scheme = useColorScheme()
  const dec = useMemo(() => decodeOverview(doc), [doc])
  const [params, setParams] = useSearchParams()

  const selected = useMemo(
    () =>
      (params.get('genres') ?? '')
        .split(',')
        .map((g) => doc.genres.indexOf(g))
        .filter((i) => i >= 0),
    [params, doc.genres],
  )
  const popMin = clampInt(params.get('pmin'), 0)
  const popMax = clampInt(params.get('pmax'), 100)
  const update = (g: number[], lo: number, hi: number) => {
    const next = new URLSearchParams()
    if (g.length) next.set('genres', g.map((i) => doc.genres[i]).join(','))
    if (lo !== 0) next.set('pmin', String(lo))
    if (hi !== 100) next.set('pmax', String(hi))
    setParams(next, { replace: true })
  }
  const filtered = selected.length > 0 || popMin !== 0 || popMax !== 100

  const summary = useMemo(() => summariseUnique(dec, { genres: selected, popMin, popMax }), [dec, selected, popMin, popMax])
  const allSummary = useMemo(() => summariseUnique(dec, { genres: [], popMin: 0, popMax: 100 }), [dec])
  const allStats = useMemo(() => doc.genres.map((_, g) => genreStats(doc, g, 0, 100)), [doc])
  const stats = useMemo(
    () => (selected.length ? selected : doc.genres.map((_, i) => i)).map((g) => genreStats(doc, g, popMin, popMax)),
    [doc, selected, popMin, popMax],
  )

  return (
    <>
      <div className="page-head discovery-head">
        <h1>Explore how music genres overlap</h1>
        <p className="lead">
          Compare the sound and recorded popularity of {fmtInt(meta.profile.unique_track_ids)} tracks across {meta.profile.genres} genre labels.
        </p>
        <div className="discovery-links">
          {COMPARISONS.map((comparison) => (
            <Link key={comparison.a} to={compareUrl(comparison.a, comparison.b)}>
              <span>{comparison.title}</span><span aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      </div>

      <section className="panel" aria-labelledby="filters-h">
        <h2 id="filters-h" className="visually-hidden">
          Filters
        </h2>
        <div className="filters">
          <GenrePicker genres={doc.genres} selected={selected} onChange={(g) => update(g, popMin, popMax)} help="Leave empty to include every genre." />
          <PopularityRange min={popMin} max={popMax} onChange={(lo, hi) => update(selected, lo, hi)} />
          <button type="button" onClick={() => update([], 0, 100)} disabled={!filtered}>
            Reset filters
          </button>
        </div>
        <p className="small muted" aria-live="polite" style={{ margin: '10px 0 0' }}>
          {summary.tracks
            ? `Showing ${fmtInt(summary.tracks)} unique tracks${selected.length ? ` in ${selected.length} selected genre${selected.length > 1 ? 's' : ''}` : ''} with popularity ${popMin}–${popMax}. Cards and the histogram count each track once; genre charts count memberships.`
            : 'No tracks match these filters.'}
        </p>
      </section>

      <section className="grid grid-cards" aria-label="Summary" style={{ marginTop: 16 }}>
        <StatCard label="Unique tracks" value={fmtInt(summary.tracks)} note={`of ${fmtInt(doc.uniqueTracks)}; a track in several selected genres counts once`} />
        <StatCard label="Genres" value={fmtInt(summary.genresWithTracks)} note={selected.length ? `of ${selected.length} selected with ≥1 matching track` : `of ${doc.genres.length} with ≥1 matching track`} />
        <StatCard label="Median popularity" value={summary.medianPopularity === null ? '—' : fmtNum(summary.medianPopularity, summary.medianPopularity % 1 ? 1 : 0)} note={summary.tracks ? `unique tracks; ${fmtPct(summary.popHist[0] / summary.tracks)} score 0` : 'no matching tracks'} />
        <StatCard label="Median duration" value={summary.medianDurationS === null ? '—' : `≈ ${fmtDuration(summary.medianDurationS)}`} note="min:sec, unique tracks; from 5-second bins" />
      </section>

      <Findings allSummary={allSummary} allStats={allStats} meta={meta} />

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <PopularityHistogram popHist={summary.popHist} total={summary.tracks} scheme={scheme} />
        <FeatureComparison doc={doc} selected={selected} popMin={popMin} popMax={popMax} scheme={scheme} />
      </div>
      <GenreComparison stats={stats} filtered={selected.length > 0} popMin={popMin} popMax={popMax} scheme={scheme} genresDoc={genresDoc} />
    </>
  )
}

function clampInt(v: string | null, fallback: number) {
  const n = v === null ? NaN : Number(v)
  return Number.isInteger(n) ? Math.max(0, Math.min(100, n)) : fallback
}

function Findings({ allSummary, allStats, meta }: { allSummary: ReturnType<typeof summariseUnique>; allStats: GenreStat[]; meta: MetaDoc }) {
  const zero = allSummary.popHist[0]
  const runnerUp = allSummary.popHist.slice(1).reduce((best, n, i) => (n > best.n ? { p: i + 1, n } : best), { p: 1, n: -1 })
  const zeroMedian = allStats.filter((s) => s.medianPopularity === 0).sort((a, b) => (b.zeroShare ?? 0) - (a.zeroShare ?? 0))
  const top = allStats.slice().sort((a, b) => (b.medianPopularity ?? 0) - (a.medianPopularity ?? 0))[0]
  const byName = (n: string) => allStats.find((s) => s.name === n)
  const [c, m, h] = DEFAULT_TRIO.map(byName)
  return (
    <section className="panel" aria-labelledby="findings-h" style={{ marginTop: 16 }}>
      <h2 id="findings-h">Findings</h2>
      <p className="sub" style={{ marginBottom: 12 }}>
        Computed from the whole file, independent of the filters above. Associations only; the file cannot show causes or change over time.
      </p>
      <ol className="findings">
        <li>
          <strong>Zero is by far the most common score.</strong>
          {fmtInt(zero)} of {fmtInt(allSummary.tracks)} unique tracks ({fmtPct(zero / allSummary.tracks)}) score 0, about {Math.round(zero / runnerUp.n)} times as many as the next most
          common value (a score of {runnerUp.p}, {fmtInt(runnerUp.n)} tracks). See the separate zero bar in the <a href="#popularity-histogram">popularity histogram</a>.{' '}
          {fmtInt(meta.profile.zero_tracks_with_nonzero_duplicate)} of these zero-score tracks have a duplicate recording under another ID with a non-zero score.
        </li>
        <li>
          <strong>
            {zeroMedian.length} genres have a median of 0; {top.name} has the highest median ({fmtNum(top.medianPopularity, 0)}).
          </strong>
          In {listFmt.format(zeroMedian.slice(0, 3).map((s) => s.name))} more than half of member tracks score 0 (respectively {zeroMedian.slice(0, 3).map((s) => fmtPct(s.zeroShare, 0)).join(', ')}). Sort the{' '}
          <a href="#genre-comparison">genre comparison</a> by "Share with popularity 0" to see the pattern. Each genre counts its own tracks (memberships).
        </li>
        {c && m && h && (
          <li>
            <strong>Classical and metal sit at opposite ends.</strong>
            Mean acousticness is {fmtNum(c.means.acousticness, 2)} for classical and {fmtNum(m.means.acousticness, 2)} for metal. Mean energy is {fmtNum(c.means.energy, 2)} versus{' '}
            {fmtNum(m.means.energy, 2)}. Hip-hop has the highest danceability of the three ({fmtNum(h.means.danceability, 2)}). See the{' '}
            <a href="#feature-comparison">feature comparison</a> ({fmtInt(c.n)}, {fmtInt(m.n)} and {fmtInt(h.n)} tracks).
          </li>
        )}
      </ol>
    </section>
  )
}

function PopularityHistogram({ popHist, total, scheme }: { popHist: number[]; total: number; scheme: string }) {
  const buckets = popularityBuckets(popHist)
  return (
    <section className="panel" id="popularity-histogram" aria-labelledby="ph-h">
      <div className="panel-head">
        <div>
          <h2 id="ph-h">Popularity distribution</h2>
          <p className="sub">Unique tracks per popularity bucket. Zero has its own bar. n = {fmtInt(total)}</p>
        </div>
      </div>
      {total === 0 ? (
        <Empty>No tracks match these filters. Widen the popularity range or clear the genre filter.</Empty>
      ) : (
        <Chart
          label={`Histogram of popularity for ${total} unique tracks; ${buckets[0].n} have a score of 0`}
          deps={[popHist, scheme]}
          legend={[
            { label: 'Popularity = 0', color: cssVar('--series-2') },
            { label: 'Popularity 1–100 (5-point buckets)', color: cssVar('--series-1') },
          ]}
          render={(width) =>
            Plot.plot({
              ...plotBase(width),
              height: 260,
              marginLeft: 52,
              marginBottom: 62,
              x: { label: 'Popularity score →', labelAnchor: 'center', labelOffset: 58, domain: buckets.map((b) => b.label), tickRotate: -45, tickFormat: (d: string, i: number) => (i % 2 === 0 ? d : '') },
              y: { label: 'Unique tracks', grid: true, tickFormat: (d: number) => (d === 0 ? '0' : `${d / 1000}k`) },
              marks: [
                Plot.barY(buckets, {
                  x: 'label',
                  y: 'n',
                  fill: (d: { lo: number }) => (d.lo === 0 ? cssVar('--series-2') : cssVar('--series-1')),
                  ry2: 3,
                  insetLeft: 1,
                  insetRight: 1,
                  tip: { format: { fill: false, x: true, y: (v: number) => fmtInt(v) } },
                }),
                Plot.ruleY([0], { stroke: cssVar('--border-strong') }),
              ],
            })
          }
          table={{
            columns: [
              { key: 'label', label: 'Popularity' },
              { key: 'n', label: 'Unique tracks', numeric: true, format: (v) => fmtInt(v as number) },
              { key: 'share', label: 'Share', numeric: true, format: (v) => fmtPct(v as number) },
            ],
            rows: buckets.map((b) => ({ ...b, share: b.n / total })),
          }}
        />
      )}
    </section>
  )
}

function FeatureComparison({ doc, selected, popMin, popMax, scheme }: { doc: Parameters<typeof decodeOverview>[0]; selected: number[]; popMin: number; popMax: number; scheme: string }) {
  const defaults = DEFAULT_TRIO.map((g) => doc.genres.indexOf(g)).filter((i) => i >= 0)
  const using = selected.length ? selected.slice(0, 3) : defaults
  const note = selected.length === 0 ? 'Showing a default trio. Select up to three genres in the filter to compare them.' : selected.length > 3 ? `Comparing the first three of ${selected.length} selected genres.` : null
  const stats = using.map((g) => genreStats(doc, g, popMin, popMax))
  const withData = stats.filter((s) => s.n > 0)
  const colors = Object.fromEntries(using.map((g, i) => [doc.genres[g], cssVar(SERIES[i])]))
  const rows = withData.flatMap((s) => UNIT_FEATURES.map((f) => ({ genre: s.name, feature: label(f), value: s.means[f] ?? 0 })))
  return (
    <section className="panel" id="feature-comparison" aria-labelledby="fc-h">
      <div className="panel-head">
        <div>
          <h2 id="fc-h">Audio-feature comparison</h2>
          <p className="sub">Mean of each 0–1 descriptor per genre, popularity {popMin}–{popMax}. Memberships.</p>
        </div>
      </div>
      {note && <p className="small muted">{note}</p>}
      {withData.length === 0 ? (
        <Empty>None of these genres has tracks in the selected popularity range.</Empty>
      ) : (
        <>
          <Chart
            label={`Dot plot of mean audio features for ${withData.map((s) => s.name).join(', ')}`}
            deps={[rows, scheme]}
            legend={withData.map((s) => ({ label: `${s.name} (n = ${fmtInt(s.n)})`, color: colors[s.name], shape: 'dot' as const }))}
            render={(width) =>
              Plot.plot({
                ...plotBase(width),
                height: 270,
                marginLeft: 118,
                x: { domain: [0, 1], label: 'Mean value (0–1)', grid: true },
                y: { domain: UNIT_FEATURES.map(label), label: null },
                color: { domain: Object.keys(colors), range: Object.values(colors) },
                marks: [
                  Plot.ruleY(UNIT_FEATURES.map(label), { stroke: cssVar('--grid') }),
                  Plot.dot(rows, {
                    x: 'value',
                    y: 'feature',
                    fill: 'genre',
                    r: 6,
                    stroke: cssVar('--surface-1'),
                    strokeWidth: 2,
                    tip: { format: { x: (v: number) => fmtNum(v, 3), fill: true, y: true } },
                  }),
                ],
              })
            }
            table={{
              columns: [
                { key: 'feature', label: 'Feature' },
                ...withData.map((s) => ({ key: s.name, label: s.name, numeric: true, format: (v: unknown) => fmtNum(v as number, 3) })),
              ],
              rows: [...UNIT_FEATURES, 'tempo', 'loudness'].map((f) => ({
                feature: label(f),
                ...Object.fromEntries(withData.map((s) => [s.name, s.means[f as SumFeature]])),
              })),
            }}
          />
          <div className="table-scroll" style={{ maxHeight: 'none', marginTop: 10 }}>
          <table className="data">
            <caption className="visually-hidden">Tempo, loudness and duration by genre</caption>
            <thead>
              <tr>
                <th scope="col">Genre</th>
                <th scope="col" className="num">
                  Tracks
                </th>
                <th scope="col" className="num">
                  Mean tempo (BPM)
                </th>
                <th scope="col" className="num">
                  Mean loudness (dB)
                </th>
                <th scope="col" className="num">
                  Mean duration
                </th>
              </tr>
            </thead>
            <tbody>
              {withData.map((s) => (
                <tr key={s.name}>
                  <th scope="row" style={{ fontWeight: 560 }}>
                    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <i className="swatch" style={{ background: colors[s.name], borderRadius: '50%' }} aria-hidden="true" />
                      {s.name}
                    </span>
                  </th>
                  <td className="num">{fmtInt(s.n)}</td>
                  <td className="num">{fmtNum(s.means.tempo, 1)}</td>
                  <td className="num">{fmtNum(s.means.loudness, 1)}</td>
                  <td className="num">{fmtDuration(s.means.duration_s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </section>
  )
}

function GenreComparison({ stats, filtered, popMin, popMax, scheme, genresDoc }: { stats: GenreStat[]; filtered: boolean; popMin: number; popMax: number; scheme: string; genresDoc: GenresDoc }) {
  const [metric, setMetric] = useState<Metric>('medianPopularity')
  const [order, setOrder] = useState<'desc' | 'asc' | 'name'>('desc')
  const [showAll, setShowAll] = useState(false)
  const metricLabel = METRICS.find((m) => m.value === metric)!.label
  const rows = stats
    .filter((s) => s.n > 0)
    .map((s) => ({ name: s.name, n: s.n, value: metricValue(s, metric) }))
    .filter((r): r is { name: string; n: number; value: number } => r.value !== null)
    .sort((a, b) => (order === 'name' ? a.name.localeCompare(b.name) : order === 'asc' ? a.value - b.value || a.name.localeCompare(b.name) : b.value - a.value || a.name.localeCompare(b.name)))
  const limit = 20
  const shown = showAll ? rows : rows.slice(0, limit)
  const isShare = metric === 'zeroShare' || metric === 'explicit'
  const domainMax = metric === 'medianPopularity' ? 100 : isShare || UNIT_FEATURES.includes(metric as never) ? 1 : undefined
  return (
    <section className="panel" id="genre-comparison" aria-labelledby="gc-h" style={{ marginTop: 16 }}>
      <div className="panel-head">
        <div>
          <h2 id="gc-h">Genre comparison</h2>
          <p className="sub">
            {metricLabel} by genre, popularity {popMin}–{popMax}. Each genre counts its own tracks (memberships), so a track in two genres appears in both.{' '}
            {filtered ? `${rows.length} selected genres with data.` : `${rows.length} genres.`}
          </p>
        </div>
        <div className="row">
          <Select label="Metric" value={metric} options={METRICS} onChange={setMetric} />
          <Select
            label="Sort"
            value={order}
            options={[
              { value: 'desc', label: 'Highest first' },
              { value: 'asc', label: 'Lowest first' },
              { value: 'name', label: 'A–Z' },
            ]}
            onChange={setOrder}
          />
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty>No genre has tracks in this popularity range.</Empty>
      ) : (
        <>
          <Chart
            label={`Bar chart of ${metricLabel.toLowerCase()} for ${shown.length} genres, ${order === 'name' ? 'alphabetical' : order === 'desc' ? 'highest first' : 'lowest first'}`}
            deps={[shown, metric, scheme]}
            render={(width) =>
              Plot.plot({
                ...plotBase(width),
                height: shown.length * 20 + 50,
                marginLeft: 130,
                marginRight: 56,
                x: { label: metricLabel, grid: true, domain: domainMax ? [0, domainMax] : undefined, tickFormat: isShare ? '.0%' : metric === 'n' ? 's' : undefined },
                y: { domain: shown.map((r) => r.name), label: null },
                marks: [
                  Plot.barX(shown, {
                    y: 'name',
                    x1: metric === 'loudness' ? (d: { value: number }) => d.value : 0,
                    x2: metric === 'loudness' ? 0 : 'value',
                    fill: cssVar('--series-1'),
                    rx2: metric === 'loudness' ? 0 : 3,
                    rx1: metric === 'loudness' ? 3 : 0,
                    insetTop: 2,
                    insetBottom: 2,
                    channels: { tracks: { value: 'n', label: 'Tracks' } },
                    tip: { format: { x1: false, x2: (v: number) => formatMetric(metric, v), y: true, tracks: (v: number) => fmtInt(v) } },
                  }),
                  Plot.text(shown, {
                    y: 'name',
                    x: metric === 'loudness' ? 0 : 'value',
                    text: (d: { value: number }) => formatMetric(metric, d.value),
                    textAnchor: 'start',
                    dx: 6,
                    fill: cssVar('--text-secondary'),
                  }),
                  Plot.ruleX([0], { stroke: cssVar('--border-strong') }),
                ],
              })
            }
            table={{
              columns: [
                { key: 'name', label: 'Genre' },
                { key: 'value', label: metricLabel, numeric: true, format: (v) => formatMetric(metric, v as number) },
                { key: 'n', label: 'Tracks', numeric: true, format: (v) => fmtInt(v as number) },
              ],
              rows,
            }}
          />
          {rows.length > limit && (
            <button type="button" onClick={() => setShowAll((s) => !s)} style={{ marginTop: 8 }} aria-expanded={showAll}>
              {showAll ? `Show top ${limit} only` : `Show all ${rows.length} genres`}
            </button>
          )}
          <p className="small muted" style={{ marginTop: 8 }}>
            Genres hold {fmtInt(Math.min(...genresDoc.genres.map((g) => g.tracks)))}–{fmtInt(Math.max(...genresDoc.genres.map((g) => g.tracks)))} tracks each because the sample
            was collected per genre label, so track counts describe the sampling, not how common a genre is.
          </p>
        </>
      )}
    </section>
  )
}
