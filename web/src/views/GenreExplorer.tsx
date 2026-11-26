import * as Plot from '@observablehq/plot'
import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Chart } from '../components/Chart'
import { cssVar, plotBase, useColorScheme } from '../lib/chartTheme'
import { Empty, ErrorBox, Loading, Pager, Select } from '../components/ui'
import { useAsync } from '../lib/useAsync'
import { loadGenres, loadSimilarity } from '../lib/data'
import { centroidExplanation } from '../lib/explain'
import { fmtDuration, fmtInt, fmtNum, fmtPct, label } from '../lib/format'
import { UNIT_FEATURES, type GenreProfile, type GenresDoc, type ProfileFeature, type SimilaritySpec } from '../lib/types'

type Col = 'name' | 'tracks' | 'popularity' | 'zeroShare' | ProfileFeature
const COLS: { key: Col; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Genre' },
  { key: 'tracks', label: 'Tracks', numeric: true },
  { key: 'popularity', label: 'Median pop.', numeric: true },
  { key: 'zeroShare', label: 'Pop. = 0', numeric: true },
  { key: 'energy', label: 'Energy', numeric: true },
  { key: 'danceability', label: 'Dance.', numeric: true },
  { key: 'acousticness', label: 'Acoustic.', numeric: true },
  { key: 'tempo', label: 'Tempo', numeric: true },
]
const FEATURE_OPTIONS = [...UNIT_FEATURES, 'tempo', 'loudness'].map((f) => ({ value: f as ProfileFeature, label: label(f) }))

function value(g: GenreProfile, c: Col): number | string {
  if (c === 'name') return g.name
  if (c === 'tracks') return g.tracks
  if (c === 'popularity') return g.popularity.median
  if (c === 'zeroShare') return g.popularity.zeroShare
  return g.features[c].mean
}

function cell(g: GenreProfile, c: Col): string {
  const v = value(g, c)
  if (typeof v === 'string') return v
  if (c === 'tracks') return fmtInt(v)
  if (c === 'popularity') return fmtNum(v, v % 1 ? 1 : 0)
  if (c === 'zeroShare') return fmtPct(v, 0)
  if (c === 'tempo' || c === 'loudness') return fmtNum(v, 1)
  return fmtNum(v, 2)
}

export default function GenreExplorer() {
  const g = useAsync(loadGenres)
  const s = useAsync(loadSimilarity)
  if (g.error || s.error) return <ErrorBox error={(g.error ?? s.error)!} />
  if (!g.data || !s.data) return <Loading what="genre profiles" />
  return <Body doc={g.data} sim={s.data} />
}

function Body({ doc, sim }: { doc: GenresDoc; sim: SimilaritySpec }) {
  const id = useId()
  const scheme = useColorScheme()
  const [text, setText] = useState('')
  const [popLo, setPopLo] = useState(0)
  const [popHi, setPopHi] = useState(100)
  const [feat, setFeat] = useState<ProfileFeature>('energy')
  const [featLo, setFeatLo] = useState('')
  const [featHi, setFeatHi] = useState('')
  const [sort, setSort] = useState<{ key: Col; dir: 'asc' | 'desc' }>({ key: 'popularity', dir: 'desc' })
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string>('pop')
  const [xf, setXf] = useState<ProfileFeature>('acousticness')
  const [yf, setYf] = useState<ProfileFeature>('energy')
  const pageSize = 15

  const filtered = useMemo(() => {
    const t = text.trim().toLowerCase()
    const lo = featLo === '' ? -Infinity : Number(featLo)
    const hi = featHi === '' ? Infinity : Number(featHi)
    return doc.genres.filter((g) => {
      if (t && !g.name.toLowerCase().includes(t)) return false
      if (g.popularity.median < popLo || g.popularity.median > popHi) return false
      const v = g.features[feat].mean
      return v >= lo && v <= hi
    })
  }, [doc, text, popLo, popHi, feat, featLo, featHi])

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return filtered.slice().sort((a, b) => {
      const va = value(a, sort.key)
      const vb = value(b, sort.key)
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
      return dir * c || a.name.localeCompare(b.name)
    })
  }, [filtered, sort])

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, pages - 1)
  const rows = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const current = doc.genres.find((g) => g.name === selected) ?? null
  const reset = () => {
    setText('')
    setPopLo(0)
    setPopHi(100)
    setFeatLo('')
    setFeatHi('')
    setPage(0)
  }
  const dirty = text || popLo !== 0 || popHi !== 100 || featLo || featHi
  const matching = new Set(filtered.map((g) => g.name))

  return (
    <>
      <div className="page-head">
        <h1>Genre Explorer</h1>
        <p className="lead">
          Profiles for all {doc.genres.length} genre labels: audio features, popularity and the acoustically closest genres. Statistics count each genre's own tracks
          (memberships).
        </p>
        <p className="notice small" style={{ marginTop: 8 }}>
          This public edition replaces track-level search with genre exploration. Track titles, artists and per-track features are not published because redistribution
          rights for them could not be confirmed. <Link to="/method#publication">Read why</Link>, or run TrackLens locally with the CSV to search individual tracks.
        </p>
      </div>

      <section className="panel" aria-label="Filters">
        <div className="filters">
          <div className="field">
            <label htmlFor={`${id}-q`}>Search genres</label>
            <input
              id={`${id}-q`}
              type="search"
              value={text}
              placeholder="e.g. rock"
              onChange={(e) => {
                setText(e.target.value)
                setPage(0)
              }}
            />
          </div>
          <fieldset className="field">
            <legend>Median popularity</legend>
            <div className="row" style={{ gap: 6 }}>
              <input type="number" aria-label="Minimum median popularity" min={0} max={100} value={popLo} onChange={(e) => (setPopLo(Number(e.target.value) || 0), setPage(0))} />
              <span aria-hidden="true">to</span>
              <input type="number" aria-label="Maximum median popularity" min={0} max={100} value={popHi} onChange={(e) => (setPopHi(e.target.value === '' ? 100 : Number(e.target.value)), setPage(0))} />
            </div>
          </fieldset>
          <fieldset className="field">
            <legend>Mean audio feature</legend>
            <div className="row" style={{ gap: 6 }}>
              <Select label="Feature to filter" hideLabel value={feat} options={FEATURE_OPTIONS} onChange={(v) => (setFeat(v), setPage(0))} />
              <input type="number" step="0.01" aria-label={`Minimum mean ${label(feat)}`} placeholder="min" value={featLo} onChange={(e) => (setFeatLo(e.target.value), setPage(0))} />
              <span aria-hidden="true">to</span>
              <input type="number" step="0.01" aria-label={`Maximum mean ${label(feat)}`} placeholder="max" value={featHi} onChange={(e) => (setFeatHi(e.target.value), setPage(0))} />
            </div>
          </fieldset>
          <button type="button" onClick={reset} disabled={!dirty}>
            Reset filters
          </button>
        </div>
        <p className="small muted" aria-live="polite" style={{ margin: '10px 0 0' }}>
          {filtered.length} of {doc.genres.length} genres match.
        </p>
      </section>

      <div className="master-detail" style={{ marginTop: 16 }}>
        <div className="stack">
          <section className="panel" aria-labelledby="gt-h">
            <h2 id="gt-h">Genres</h2>
            {rows.length === 0 ? (
              <Empty>
                No genre matches these filters.{' '}
                <button type="button" className="link" onClick={reset}>
                  Reset filters
                </button>
              </Empty>
            ) : (
              <>
                <div className="table-scroll" style={{ maxHeight: 'none' }}>
                  <table className="data">
                    <caption className="visually-hidden">Genres matching the filters, sortable by column</caption>
                    <thead>
                      <tr>
                        {COLS.map((c) => (
                          <th
                            key={c.key}
                            scope="col"
                            className={c.numeric ? 'num' : undefined}
                            aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                          >
                            <button
                              type="button"
                              className="sort"
                              onClick={() => {
                                setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 'asc' ? 'desc' : 'asc') : c.key === 'name' ? 'asc' : 'desc' }))
                                setPage(0)
                              }}
                            >
                              {c.label}
                              <span aria-hidden="true">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((g) => (
                        <tr key={g.name} className={g.name === selected ? 'selected' : undefined}>
                          {COLS.map((c) =>
                            c.key === 'name' ? (
                              <th key={c.key} scope="row">
                                <button type="button" className="link" aria-pressed={g.name === selected} onClick={() => setSelected(g.name)}>
                                  {g.name}
                                </button>
                              </th>
                            ) : (
                              <td key={c.key} className="num">
                                {cell(g, c.key)}
                              </td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={safePage} pageSize={pageSize} total={sorted.length} onPage={setPage} noun="genres" />
              </>
            )}
          </section>

          <section className="panel" aria-labelledby="gs-h">
            <div className="panel-head">
              <div>
                <h2 id="gs-h">Genre map</h2>
                <p className="sub">One dot per genre at its mean values. Genres outside the filters are faded. {current ? `${current.name} is highlighted.` : ''}</p>
              </div>
              <div className="row">
                <Select label="X axis" value={xf} options={FEATURE_OPTIONS} onChange={setXf} />
                <Select label="Y axis" value={yf} options={FEATURE_OPTIONS} onChange={setYf} />
              </div>
            </div>
            <Chart
              label={`Scatter plot of genres by mean ${label(xf)} and mean ${label(yf)}`}
              deps={[xf, yf, selected, filtered, scheme]}
              legend={[
                { label: 'Matches filters', color: cssVar('--series-1'), shape: 'dot' },
                { label: 'Filtered out', color: cssVar('--neutral-mark'), shape: 'dot' },
                ...(current ? [{ label: current.name, color: cssVar('--series-2'), shape: 'dot' as const }] : []),
              ]}
              render={(width) => {
                const pts = doc.genres.map((g) => ({ name: g.name, x: g.features[xf].mean, y: g.features[yf].mean, on: matching.has(g.name), sel: g.name === selected }))
                return Plot.plot({
                  ...plotBase(width),
                  height: 360,
                  marginLeft: 50,
                  x: { label: `Mean ${label(xf)}`, grid: true, nice: true },
                  y: { label: `Mean ${label(yf)}`, grid: true, nice: true },
                  marks: [
                    Plot.dot(
                      pts.filter((p) => !p.on),
                      { x: 'x', y: 'y', r: 4, fill: cssVar('--neutral-mark'), fillOpacity: 0.5 },
                    ),
                    Plot.dot(
                      pts.filter((p) => p.on && !p.sel),
                      { x: 'x', y: 'y', r: 5, fill: cssVar('--series-1'), stroke: cssVar('--surface-1'), strokeWidth: 1.5 },
                    ),
                    Plot.dot(
                      pts.filter((p) => p.sel),
                      { x: 'x', y: 'y', r: 8, fill: cssVar('--series-2'), stroke: cssVar('--surface-1'), strokeWidth: 2 },
                    ),
                    Plot.text(
                      pts.filter((p) => p.sel),
                      { x: 'x', y: 'y', text: 'name', dy: -14, fill: cssVar('--text-primary'), fontWeight: 600 },
                    ),
                    Plot.tip(pts, Plot.pointer({ x: 'x', y: 'y', title: (p: { name: string; x: number; y: number }) => `${p.name}\n${label(xf)}: ${fmtNum(p.x, 2)}\n${label(yf)}: ${fmtNum(p.y, 2)}` })),
                  ],
                })
              }}
              table={{
                columns: [
                  { key: 'name', label: 'Genre' },
                  { key: 'x', label: `Mean ${label(xf)}`, numeric: true, format: (v) => fmtNum(v as number, 3) },
                  { key: 'y', label: `Mean ${label(yf)}`, numeric: true, format: (v) => fmtNum(v as number, 3) },
                ],
                rows: doc.genres.map((g) => ({ name: g.name, x: g.features[xf].mean, y: g.features[yf].mean })),
              }}
            />
          </section>
        </div>

        <aside className="detail panel" aria-labelledby="gd-h" aria-live="polite">
          {current ? <GenreDetail g={current} doc={doc} sim={sim} onPick={setSelected} /> : <Empty>Select a genre to see its profile.</Empty>}
        </aside>
      </div>
    </>
  )
}

export function GenreDetail({ g, doc, sim, onPick }: { g: GenreProfile; doc: GenresDoc; sim: SimilaritySpec; onPick: (name: string) => void }) {
  const o = doc.overall
  return (
    <>
      <h2 id="gd-h">{g.name}</h2>
      <p className="sub">
        {fmtInt(g.tracks)} tracks; {fmtInt(g.sharedTracks)} are also listed under another genre.
      </p>
      <dl className="kv" style={{ margin: '12px 0' }}>
        <dt>Median popularity</dt>
        <dd>
          {fmtNum(g.popularity.median, 0)} (IQR {fmtNum(g.popularity.q1, 0)}–{fmtNum(g.popularity.q3, 0)}); all tracks {fmtNum(o.popularity.median, 0)}
        </dd>
        <dt>Popularity = 0</dt>
        <dd>
          {fmtPct(g.popularity.zeroShare)} (all tracks {fmtPct(o.popularity.zeroShare)})
        </dd>
        <dt>Median duration</dt>
        <dd>{fmtDuration(g.durationMinutes.median * 60)}</dd>
        <dt>Explicit</dt>
        <dd>{fmtPct(g.explicitShare)}</dd>
        <dt>Major mode</dt>
        <dd>{fmtPct(g.modeMajorShare)}</dd>
        <dt>Tempo / loudness</dt>
        <dd>
          {fmtNum(g.features.tempo.mean, 1)} BPM / {fmtNum(g.features.loudness.mean, 1)} dB
        </dd>
      </dl>
      <h3>Audio profile</h3>
      <p className="small muted">Bar = genre mean; tick = mean over all unique tracks.</p>
      <div className="feature-rows" role="list">
        {UNIT_FEATURES.map((f) => (
          <div key={f} role="listitem" style={{ display: 'contents' }}>
            <span>{label(f)}</span>
            <span className="bar-track" aria-hidden="true">
              <span className="bar-fill" style={{ width: `${g.features[f].mean * 100}%` }} />
              <span className="bar-ref" style={{ left: `${o.features[f].mean * 100}%` }} />
            </span>
            <span className="num" aria-label={`${label(f)} mean ${fmtNum(g.features[f].mean, 2)}, all tracks ${fmtNum(o.features[f].mean, 2)}`}>
              {fmtNum(g.features[f].mean, 2)}
            </span>
          </div>
        ))}
      </div>
      <h3 style={{ marginTop: 16 }}>Acoustically closest genres</h3>
      <p className="small muted">Distance between genre centroids on {sim.features.length} z-scored audio features. Not a measure of shared listeners.</p>
      <ol className="result-list">
        {g.neighbors.slice(0, 5).map((n) => {
          const other = doc.genres.find((x) => x.name === n.genre)!
          return (
            <li key={n.genre}>
              <button type="button" className="link" onClick={() => onPick(n.genre)}>
                {n.genre}
              </button>{' '}
              <span className="muted small">distance {fmtNum(n.distance, 2)}</span>
              <div className="cell-sub">{centroidExplanation(g, other, sim)}</div>
            </li>
          )
        })}
      </ol>
      <p className="small" style={{ marginTop: 10 }}>
        <Link to={`/overview?genres=${encodeURIComponent([g.name, ...g.neighbors.slice(0, 2).map((n) => n.genre)].join(','))}`}>Compare {g.name} with its two closest genres in the overview</Link>
      </p>
    </>
  )
}

