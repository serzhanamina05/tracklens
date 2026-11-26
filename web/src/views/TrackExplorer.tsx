import * as Plot from '@observablehq/plot'
import { useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Chart } from '../components/Chart'
import { cssVar, plotBase, useColorScheme } from '../lib/chartTheme'
import { Empty, ErrorBox, GenrePicker, Loading, Pager, PopularityRange, Select } from '../components/ui'
import { useAsync } from '../lib/useAsync'
import { loadOverview } from '../lib/data'
import { fmtDuration, fmtInt, fmtNum, fmtPct, KEY_NAMES, label } from '../lib/format'
import { explainNeighbor } from '../lib/explain'
import { initTracks, queryTracks, similarTracks, type QueryResult, type SimilarResult, type TrackRow } from '../lib/trackProtocol'
import { FILTER_FEATURES, type FilterFeature, type SortKey, type TrackQuery } from '../lib/tracks'

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'popularity', label: 'Popularity' },
  { value: 'name', label: 'Title' },
  { value: 'artists', label: 'Artist' },
  { value: 'duration_ms', label: 'Duration' },
  ...FILTER_FEATURES.map((f) => ({ value: f as SortKey, label: label(f) })),
]
const FEATURE_OPTIONS = FILTER_FEATURES.map((f) => ({ value: f, label: label(f) }))

export default function TrackExplorer() {
  const ov = useAsync(loadOverview)
  const init = useAsync(initTracks)
  if (ov.error || init.error) return <ErrorBox error={(ov.error ?? init.error)!} />
  if (!ov.data || !init.data) return <Loading what="the local track table (about 17 MB)" />
  return <Body genres={ov.data.genres} domains={init.data.domains} />
}

function Body({ genres, domains }: { genres: string[]; domains: Record<FilterFeature, [number, number]> }) {
  const id = useId()
  const scheme = useColorScheme()
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sel, setSel] = useState<number[]>([])
  const [pop, setPop] = useState<[number, number]>([0, 100])
  const [ranges, setRanges] = useState<Partial<Record<FilterFeature, [string, string]>>>({})
  const [sort, setSort] = useState<TrackQuery['sort']>({ key: 'popularity', dir: 'desc' })
  const [page, setPage] = useState(0)
  const [plot, setPlot] = useState<{ x: FilterFeature; y: FilterFeature }>({ x: 'energy', y: 'danceability' })
  const [res, setRes] = useState<QueryResult | null>(null)
  const [selected, setSelected] = useState<TrackRow | null>(null)
  const pageSize = 25

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 200)
    return () => clearTimeout(t)
  }, [text])

  const features = useMemo(() => {
    const out: TrackQuery['features'] = {}
    for (const [f, [lo, hi]] of Object.entries(ranges) as [FilterFeature, [string, string]][]) {
      if (lo === '' && hi === '') continue
      out[f] = [lo === '' ? -Infinity : Number(lo), hi === '' ? Infinity : Number(hi)]
    }
    return out
  }, [ranges])

  useEffect(() => {
    let live = true
    queryTracks({ text: debounced, genres: sel, popMin: pop[0], popMax: pop[1], features, sort, page, pageSize }, plot).then((r) => {
      if (!live) return
      setRes(r)
      setSelected((s) => s ?? r.rows[0] ?? null)
    })
    return () => {
      live = false
    }
  }, [debounced, sel, pop, features, sort, page, plot])

  const resetPage = () => setPage(0)
  const reset = () => {
    setText('')
    setDebounced('')
    setSel([])
    setPop([0, 100])
    setRanges({})
    setPage(0)
  }
  const dirty = text || sel.length || pop[0] !== 0 || pop[1] !== 100 || Object.keys(features).length

  return (
    <>
      <div className="page-head">
        <h1>Track Explorer</h1>
        <p className="lead">Search {fmtInt(89741)} unique tracks by title, artist or album, then narrow by genre, popularity and audio features. Counts cover every matching track.</p>
      </div>

      <section className="panel" aria-label="Filters">
        <div className="filters">
          <div className="field" style={{ flex: '1 1 240px' }}>
            <label htmlFor={`${id}-q`}>Search title, artist or album</label>
            <input
              id={`${id}-q`}
              type="search"
              value={text}
              placeholder="e.g. beyonce, acoustic"
              onChange={(e) => {
                setText(e.target.value)
                resetPage()
              }}
            />
          </div>
          <GenrePicker genres={genres} selected={sel} onChange={(g) => (setSel(g), resetPage())} help="A track matches if it is in any selected genre." />
          <PopularityRange min={pop[0]} max={pop[1]} onChange={(a, b) => (setPop([a, b]), resetPage())} />
          <button type="button" onClick={reset} disabled={!dirty}>
            Reset all filters
          </button>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary>Audio-feature ranges {Object.keys(features).length ? `(${Object.keys(features).length} active)` : ''}</summary>
          <div className="row" style={{ marginTop: 10, alignItems: 'flex-start', gap: 16 }}>
            {FILTER_FEATURES.map((f) => (
              <fieldset key={f} className="field">
                <legend>
                  {label(f)} <span className="muted">({domains[f][0]} to {domains[f][1]})</span>
                </legend>
                <div className="row" style={{ gap: 4 }}>
                  {(['min', 'max'] as const).map((side, k) => (
                    <input
                      key={side}
                      type="number"
                      step={f === 'tempo' || f === 'loudness' ? 1 : 0.05}
                      aria-label={`${label(f)} ${side}imum`}
                      placeholder={side}
                      value={ranges[f]?.[k] ?? ''}
                      onChange={(e) => {
                        const cur = ranges[f] ?? ['', '']
                        const next: [string, string] = k === 0 ? [e.target.value, cur[1]] : [cur[0], e.target.value]
                        setRanges((r) => ({ ...r, [f]: next }))
                        resetPage()
                      }}
                    />
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </details>
        <p className="small muted" aria-live="polite" style={{ margin: '10px 0 0' }}>
          {res
            ? res.total
              ? `${fmtInt(res.total)} matching unique tracks · median popularity ${fmtNum(res.medianPopularity, res.medianPopularity! % 1 ? 1 : 0)} · ${fmtPct(res.zeroShare)} score 0`
              : 'No tracks match. Try a shorter search or reset the filters.'
            : 'Searching…'}
        </p>
      </section>

      <div className="master-detail" style={{ marginTop: 16 }}>
        <div className="stack">
          <section className="panel" aria-labelledby="tt-h">
            <div className="panel-head">
              <h2 id="tt-h">Tracks</h2>
              <div className="row">
                <Select label="Sort by" value={sort.key} options={SORTS} onChange={(k) => (setSort((s) => ({ ...s, key: k })), resetPage())} />
                <Select
                  label="Order"
                  value={sort.dir}
                  options={[
                    { value: 'desc', label: 'Descending' },
                    { value: 'asc', label: 'Ascending' },
                  ]}
                  onChange={(d) => (setSort((s) => ({ ...s, dir: d })), resetPage())}
                />
              </div>
            </div>
            {!res ? (
              <Loading what="tracks" />
            ) : res.total === 0 ? (
              <Empty>
                No tracks match these filters.{' '}
                <button type="button" className="link" onClick={reset}>
                  Reset all filters
                </button>
              </Empty>
            ) : (
              <>
                <div className="table-scroll" style={{ maxHeight: 'none' }}>
                  <table className="data">
                    <caption className="visually-hidden">Matching tracks, page {page + 1}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Track</th>
                        <th scope="col">Genres</th>
                        <th scope="col" className="num">
                          Pop.
                        </th>
                        <th scope="col" className="num">
                          Energy
                        </th>
                        <th scope="col" className="num">
                          Dance.
                        </th>
                        <th scope="col" className="num">
                          Tempo
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {res.rows.map((r) => (
                        <tr key={r.index} className={selected?.index === r.index ? 'selected' : undefined}>
                          <th scope="row" style={{ fontWeight: 400 }}>
                            <button type="button" className="link cell-title" aria-pressed={selected?.index === r.index} onClick={() => setSelected(r)}>
                              {r.name || 'Untitled'}
                            </button>
                            <div className="cell-sub">
                              {r.artists || 'Unknown artist'} · {r.album || 'Unknown album'}
                            </div>
                          </th>
                          <td className="small">{r.genres.join(', ')}</td>
                          <td className="num">{r.popularity}</td>
                          <td className="num">{fmtNum(r.features.energy, 2)}</td>
                          <td className="num">{fmtNum(r.features.danceability, 2)}</td>
                          <td className="num">{fmtNum(r.features.tempo, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={page} pageSize={pageSize} total={res.total} onPage={setPage} noun="tracks" />
              </>
            )}
          </section>

          {res && res.total > 0 && (
            <section className="panel" aria-labelledby="dens-h">
              <div className="panel-head">
                <div>
                  <h2 id="dens-h">Feature density</h2>
                  <p className="sub">All {fmtInt(res.density.plotted)} matching tracks in a 30 × 30 grid. Nothing is sampled. Darker cells hold more tracks.</p>
                </div>
                <div className="row">
                  <Select label="X axis" value={plot.x} options={FEATURE_OPTIONS} onChange={(x) => setPlot((p) => ({ ...p, x }))} />
                  <Select label="Y axis" value={plot.y} options={FEATURE_OPTIONS} onChange={(y) => setPlot((p) => ({ ...p, y }))} />
                </div>
              </div>
              <DensityChart d={res.density} scheme={scheme} />
            </section>
          )}
        </div>

        <aside className="detail panel" aria-live="polite" aria-labelledby="td-h">
          {selected ? <TrackDetail t={selected} /> : <Empty>Select a track to see its features and similar tracks.</Empty>}
        </aside>
      </div>
    </>
  )
}

function DensityChart({ d, scheme }: { d: QueryResult['density']; scheme: string }) {
  const cells = useMemo(() => {
    const w = (d.xDomain[1] - d.xDomain[0]) / d.nx
    const h = (d.yDomain[1] - d.yDomain[0]) / d.ny
    const out = []
    for (let j = 0; j < d.ny; j++)
      for (let i = 0; i < d.nx; i++) {
        const n = d.counts[j * d.nx + i]
        if (n) out.push({ x1: d.xDomain[0] + i * w, x2: d.xDomain[0] + (i + 1) * w, y1: d.yDomain[0] + j * h, y2: d.yDomain[0] + (j + 1) * h, n })
      }
    return out
  }, [d])
  return (
    <Chart
      label={`Density heatmap of ${label(d.x)} against ${label(d.y)} for ${d.plotted} tracks`}
      deps={[cells, scheme]}
      render={(width) =>
        Plot.plot({
          ...plotBase(width),
          height: 340,
          marginLeft: 50,
          x: { domain: d.xDomain, label: label(d.x) },
          y: { domain: d.yDomain, label: label(d.y) },
          color: { type: 'sqrt', range: [cssVar('--seq-low'), cssVar('--seq-high')], legend: true, label: 'Tracks per cell', width: 240 },
          marks: [Plot.rect(cells, { x1: 'x1', x2: 'x2', y1: 'y1', y2: 'y2', fill: 'n', tip: { format: { fill: (v: number) => fmtInt(v), x1: (v: number) => fmtNum(v, 2), y1: (v: number) => fmtNum(v, 2), x2: false, y2: false } } })],
        })
      }
    />
  )
}

const topFiveSimilar = (index: number): Promise<SimilarResult> => similarTracks(index, 5)

function TrackDetail({ t }: { t: TrackRow }) {
  const sim = useAsync(topFiveSimilar, t.index)
  return (
    <>
      <h2 id="td-h">{t.name || 'Untitled'}</h2>
      <p className="sub">
        {t.artists || 'Unknown artist'} · {t.album || 'Unknown album'}
      </p>
      <dl className="kv" style={{ margin: '12px 0' }}>
        <dt>Popularity</dt>
        <dd>{t.popularity} / 100</dd>
        <dt>Genres</dt>
        <dd>{t.genres.join(', ')}</dd>
        <dt>Duration</dt>
        <dd>{fmtDuration(t.duration_ms / 1000)}</dd>
        <dt>Key / mode</dt>
        <dd>
          {KEY_NAMES[t.key]} {t.mode ? 'major' : 'minor'} · {t.time_signature}/4
        </dd>
        <dt>Tempo / loudness</dt>
        <dd>
          {fmtNum(t.features.tempo, 1)} BPM / {fmtNum(t.features.loudness, 1)} dB
        </dd>
        <dt>Explicit</dt>
        <dd>{t.explicit ? 'Yes' : 'No'}</dd>
      </dl>
      <div className="feature-rows">
        {(['danceability', 'energy', 'speechiness', 'acousticness', 'instrumentalness', 'liveness', 'valence'] as const).map((f) => (
          <div key={f} style={{ display: 'contents' }}>
            <span>{label(f)}</span>
            <span className="bar-track" aria-hidden="true">
              <span className="bar-fill" style={{ width: `${t.features[f] * 100}%` }} />
            </span>
            <span className="num">{fmtNum(t.features[f], 2)}</span>
          </div>
        ))}
      </div>
      <div className="row" style={{ margin: '14px 0' }}>
        <Link className="button" to={`/similar?track=${t.index}`}>
          Find similar tracks
        </Link>
        <Link className="button" to={`/model?track=${t.index}`}>
          Estimate in Model Lab
        </Link>
      </div>
      <h3>Closest by audio features</h3>
      {sim.loading ? (
        <Loading what="similar tracks" />
      ) : sim.data && sim.data.length ? (
        <ol className="result-list">
          {sim.data.map((n) => (
            <li key={n.index}>
              <span className="cell-title">{n.track.name}</span> <span className="muted small">· {n.track.artists}</span>
              <div className="cell-sub">{explainNeighbor(n)}</div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="small muted">{t.valid ? 'No similar tracks found.' : 'This track has invalid features and is excluded from similarity search.'}</p>
      )}
    </>
  )
}

