import * as Plot from '@observablehq/plot'
import { useEffect, useId, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Chart } from '../components/Chart'
import { cssVar, plotBase, useColorScheme } from '../lib/chartTheme'
import { ErrorBox, Loading, StatCard } from '../components/ui'
import { useAsync } from '../lib/useAsync'
import { TrackSearch } from '../components/TrackSearch'
import { FULL_MODE, loadGenres, loadModel, loadModelEval } from '../lib/data'
import { fmtInt, fmtNum, KEY_NAMES, label } from '../lib/format'
import { clip, predictRaw, toVector, validateInput } from '../lib/model'
import { trackDetail, type TrackRow } from '../lib/trackProtocol'
import { UNIT_FEATURES, type GenresDoc, type ModelEval, type ModelSpec } from '../lib/types'

type Draft = Record<string, string>

function toDraft(values: Record<string, number>): Draft {
  const d: Draft = {}
  for (const [k, v] of Object.entries(values)) d[k] = k === 'duration_ms' ? String(v / 1000) : String(v)
  return d
}

/** Parse the form into model units. Duration is entered in seconds. */
function parseDraft(spec: ModelSpec, d: Draft): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const f of spec.features) {
    const raw = (d[f] ?? '').trim()
    if (raw === '') {
      out[f] = null
      continue
    }
    const n = Number(raw)
    out[f] = f === 'duration_ms' && Number.isFinite(n) ? Math.round(n * 1000) : n
  }
  return out
}

export default function ModelLab() {
  const model = useAsync(loadModel)
  const ev = useAsync(loadModelEval)
  const genres = useAsync(loadGenres)
  const err = model.error ?? ev.error ?? genres.error
  if (err) return <ErrorBox error={err} />
  if (!model.data || !ev.data || !genres.data) return <Loading what="the trained model" />
  const spec = model.data
  if ([ev.data, genres.data].some((doc) =>
    doc.buildId !== spec.buildId || doc.dataSha256 !== spec.dataSha256 || doc.schemaVersion !== spec.schemaVersion
  )) {
    return <ErrorBox error={new Error('Model data came from different builds. Reload the page to try again.')} />
  }
  return <Lab spec={spec} ev={ev.data} genres={genres.data} />
}

function Lab({ spec, ev, genres }: { spec: ModelSpec; ev: ModelEval; genres: GenresDoc }) {
  const [params, setParams] = useSearchParams()
  const [draft, setDraft] = useState<Draft>(() => toDraft(spec.defaults))
  const [source, setSource] = useState<string>('Training-split medians')
  const [track, setTrack] = useState<TrackRow | null>(null)

  const trackParam = params.get('track')
  useEffect(() => {
    if (!FULL_MODE || trackParam === null) return
    trackDetail(Number(trackParam)).then((t) => {
      setTrack(t)
      setSource(`${t.name} · ${t.artists}`)
      setDraft(toDraft(trackInputs(t)))
    })
  }, [trackParam])

  const parsed = useMemo(() => parseDraft(spec, draft), [spec, draft])
  const problems = useMemo(() => validateInput(spec, parsed), [spec, parsed])
  const valid = Object.keys(problems).length === 0
  const estimate = valid ? clip(spec, predictRaw(spec, toVector(spec, parsed))) : null

  const presets = useMemo(
    () => [
      { id: 'medians', label: 'Training-split medians', values: spec.defaults },
      ...genres.genres.map((g) => ({
        id: g.name,
        label: `${g.name} (genre medians)`,
        values: {
          ...spec.defaults,
          ...Object.fromEntries([...UNIT_FEATURES, 'tempo', 'loudness'].map((f) => [f, g.features[f as keyof typeof g.features].median])),
          duration_ms: Math.round(g.durationMinutes.median * 60000),
          explicit: g.explicitShare >= 0.5 ? 1 : 0,
        },
      })),
    ],
    [spec.defaults, genres],
  )

  const set = (f: string, v: string) => {
    setDraft((d) => ({ ...d, [f]: v }))
    setSource('Custom values')
  }

  return (
    <>
      <div className="page-head">
        <h1>Model Lab: estimating the popularity score from audio features</h1>
        <p className="lead">
          A gradient-boosted tree model trained on {fmtInt(spec.trainedOnRows)} tracks estimates the 0–100 popularity score recorded in this file. It uses audio features
          only, with no artist, title or genre. Compare its held-out performance with the median baseline: test MAE {fmtNum(ev.test.mae, 1)} vs {fmtNum(ev.baselineTest.mae, 1)}, R²{' '}
          {fmtNum(ev.test.r2, 2)}.
        </p>
      </div>

      <div className="lab">
        <section className="panel" aria-labelledby="inputs-h">
          <div className="panel-head">
            <div>
              <h2 id="inputs-h">Audio features</h2>
              <p className="sub">Values outside the allowed range are rejected, the same rule used in evaluation.</p>
            </div>
          </div>
          <div className="row" style={{ marginBottom: 14, alignItems: 'flex-end' }}>
            <PresetSelect
              presets={presets}
              onPick={(p) => {
                setDraft(toDraft(p.values))
                setSource(p.label)
                setTrack(null)
                if (trackParam) setParams({}, { replace: true })
              }}
            />
            {FULL_MODE && (
              <TrackSearch
                label="Or load a track"
                onPick={(t) => {
                  setParams({ track: String(t.index) }, { replace: true })
                }}
              />
            )}
          </div>
          <FeatureForm spec={spec} draft={draft} problems={problems} onChange={set} />
        </section>

        <div className="stack">
          <section className="panel" aria-labelledby="est-h" aria-live="polite">
            <h2 id="est-h">Estimated popularity</h2>
            <p className="sub" style={{ marginBottom: 10 }}>
              Input: {source}
            </p>
            {estimate === null ? (
              <div className="notice" role="alert">
                <strong>Fix {Object.keys(problems).length === 1 ? 'one field' : `${Object.keys(problems).length} fields`} to see an estimate.</strong>
                <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {Object.entries(problems).map(([f, p]) => (
                    <li key={f}>
                      {label(f)}: {p}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <EstimateView estimate={estimate} ev={ev} track={track} />
            )}
          </section>
          <section className="panel">
            <h3>What this estimate can and cannot tell you</h3>
            <ul className="small prose" style={{ paddingLeft: 18, margin: 0 }}>
              <li>It estimates one snapshot score in this dataset, not future streams or chart performance.</li>
              <li>
                Audio features miss most of what drives popularity: the artist's existing audience, promotion, playlist placement, release timing, market, and whether this ID is
                the main release or a duplicate.
              </li>
              <li>Predictions cluster near the middle of the scale. The model rarely predicts very low or very high scores, so it is least accurate at both ends.</li>
            </ul>
          </section>
        </div>
      </div>

      <Evaluation ev={ev} spec={spec} />
    </>
  )
}

function trackInputs(t: TrackRow): Record<string, number> {
  return {
    duration_ms: t.duration_ms,
    explicit: t.explicit,
    key: t.key,
    mode: t.mode,
    time_signature: t.time_signature,
    ...t.features,
  }
}

function PresetSelect({ presets, onPick }: { presets: { id: string; label: string; values: Record<string, number> }[]; onPick: (p: (typeof presets)[number]) => void }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>Start from</label>
      <select
        id={id}
        defaultValue=""
        onChange={(e) => {
          const p = presets.find((x) => x.id === e.target.value)
          if (p) onPick(p)
          e.target.value = ''
        }}
      >
        <option value="" disabled>
          Choose a preset…
        </option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function FeatureForm({ spec, draft, problems, onChange }: { spec: ModelSpec; draft: Draft; problems: Record<string, string>; onChange: (f: string, v: string) => void }) {
  const base = useId()
  const unit = (f: string) => {
    const r = spec.validation[f]
    return f === 'duration_ms' ? `${r.min / 1000}–${r.max / 1000} s` : `${r.min} to ${r.max}${r.unit === 'dB' ? ' dB' : r.unit === 'BPM' ? ' BPM' : ''}`
  }
  const err = (f: string) =>
    problems[f] ? (
      <span id={`${base}-${f}-err`} className="error-text">
        {problems[f]}
      </span>
    ) : null
  const describedBy = (f: string) => (problems[f] ? `${base}-${f}-err` : `${base}-${f}-hint`)

  const slider = (f: string, step: number) => {
    const r = spec.validation[f]
    const num = Number(draft[f])
    return (
      <div className="slider-field" key={f}>
        <label htmlFor={`${base}-${f}`}>
          {label(f)} <span className="muted" id={`${base}-${f}-hint`} style={{ fontWeight: 400 }}>
            ({unit(f)})
          </span>
        </label>
        <input
          type="range"
          min={r.min}
          max={r.max}
          step={step}
          value={Number.isFinite(num) ? Math.min(r.max, Math.max(r.min, num)) : r.min}
          aria-label={`${label(f)} slider`}
          onChange={(e) => onChange(f, e.target.value)}
        />
        <input
          id={`${base}-${f}`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={draft[f] ?? ''}
          aria-invalid={problems[f] ? true : undefined}
          aria-describedby={describedBy(f)}
          onChange={(e) => onChange(f, e.target.value)}
        />
        {err(f)}
      </div>
    )
  }

  const select = (f: string, options: { value: number; label: string }[]) => (
    <div className="field" key={f}>
      <label htmlFor={`${base}-${f}`}>{label(f)}</label>
      <select id={`${base}-${f}`} value={draft[f]} aria-describedby={describedBy(f)} onChange={(e) => onChange(f, e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span id={`${base}-${f}-hint`} className="visually-hidden">
        {unit(f)}
      </span>
      {err(f)}
    </div>
  )

  return (
    <div className="stack">
      <fieldset>
        <legend style={{ marginBottom: 8 }}>Descriptors (0–1)</legend>
        <div className="inputs">{UNIT_FEATURES.map((f) => slider(f, 0.001))}</div>
      </fieldset>
      <fieldset>
        <legend style={{ marginBottom: 8 }}>Tempo, loudness and length</legend>
        <div className="inputs">
          {slider('tempo', 0.1)}
          {slider('loudness', 0.1)}
          {slider('duration_ms', 1)}
        </div>
      </fieldset>
      <fieldset>
        <legend style={{ marginBottom: 8 }}>Musical attributes</legend>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          {select(
            'key',
            KEY_NAMES.map((k, i) => ({ value: i, label: `${k} (${i})` })),
          )}
          {select('mode', [
            { value: 1, label: 'Major (1)' },
            { value: 0, label: 'Minor (0)' },
          ])}
          {select(
            'time_signature',
            [0, 1, 3, 4, 5, 6, 7].map((v) => ({ value: v, label: v === 0 ? '0 (not detected)' : `${v}/4` })),
          )}
          {select('explicit', [
            { value: 0, label: 'No (0)' },
            { value: 1, label: 'Yes (1)' },
          ])}
        </div>
      </fieldset>
    </div>
  )
}

function EstimateView({ estimate, ev, track }: { estimate: number; ev: ModelEval; track: TrackRow | null }) {
  const mae = ev.test.mae
  const lo = Math.max(0, estimate - mae)
  const hi = Math.min(100, estimate + mae)
  return (
    <>
      <div className="row" style={{ alignItems: 'baseline', gap: 12 }}>
        <span className="estimate">{fmtNum(estimate, 1)}</span>
        <span className="muted">out of 100 (estimate of a snapshot score)</span>
      </div>
      <div className="scale" role="img" aria-label={`Estimate ${estimate.toFixed(1)} on a 0 to 100 scale; typical error band ${lo.toFixed(0)} to ${hi.toFixed(0)}; baseline ${ev.baselineValue}`}>
        <div className="band" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
        <div className="base" style={{ left: `${ev.baselineValue}%` }} title="Median baseline" />
        <div className="mark" style={{ left: `${estimate}%` }} />
        <div className="ticks" aria-hidden="true">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100</span>
        </div>
      </div>
      <p className="small">
        The shaded band is ± the test MAE ({fmtNum(mae, 1)} points), the average size of the model's error on held-out tracks. The grey tick is the baseline, which always
        predicts {ev.baselineValue}.
      </p>
      {track && (
        <dl className="kv" style={{ marginTop: 8 }}>
          <dt>Recorded score</dt>
          <dd>{track.popularity}</dd>
          <dt>Error for this track</dt>
          <dd>{fmtNum(track.popularity - estimate, 1)} (recorded − estimate)</dd>
          <dt>Split</dt>
          <dd>
            {track.split === 'train'
              ? 'Training split. The model saw this track during training, so this is not a fair test.'
              : track.split === 'test'
                ? 'Held-out test split'
                : track.split === 'validation'
                  ? 'Validation split (used for model selection)'
                  : 'Excluded from modelling'}
          </dd>
        </dl>
      )}
    </>
  )
}

function Evaluation({ ev, spec }: { ev: ModelEval; spec: ModelSpec }) {
  const scheme = useColorScheme()
  const [low, high] = ev.maeGain.interval95
  const s = ev.split.rows
  return (
    <section style={{ marginTop: 24 }} aria-labelledby="eval-h">
      <div className="page-head" style={{ marginBottom: 12 }}>
        <h2 id="eval-h" style={{ fontSize: '1.4rem' }}>
          How well does it work?
        </h2>
        <p className="lead">
          All numbers come from the training run and are measured on {fmtInt(ev.testRows)} held-out test tracks that played no part in training or model selection.
        </p>
      </div>
      <div className="metric-tiles">
        <StatCard label="Test MAE" value={fmtNum(ev.test.mae, 2)} note={`Baseline MAE ${fmtNum(ev.baselineTest.mae, 2)}`} />
        <StatCard label="Test RMSE" value={fmtNum(ev.test.rmse, 2)} note={`baseline ${fmtNum(ev.baselineTest.rmse, 2)}`} />
        <StatCard label="Test R²" value={fmtNum(ev.test.r2, 3)} note="share of variance explained; baseline ≈ 0" />
        <StatCard label="Split (train / val / test)" value={<span style={{ fontSize: '1.15rem' }}>{`${fmtInt(s.train)} / ${fmtInt(s.validation)} / ${fmtInt(s.test)}`}</span>} note="by duplicate-recording group, seed 42" />
      </div>

      <p className="sub" style={{ marginTop: 12 }}>
        Baseline minus model MAE is {fmtNum(ev.maeGain.points, 2)} points
        (95% recording-group bootstrap interval {fmtNum(low, 2)} to {fmtNum(high, 2)}).
        {ev.nonzero.mae !== null && ev.nonzero.baselineMae !== null && (
          <> On {fmtInt(ev.nonzero.n)} nonzero-score tracks, MAE is {fmtNum(ev.nonzero.mae, 2)} versus {fmtNum(ev.nonzero.baselineMae, 2)} for the baseline.</>
        )}
      </p>
      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <section className="panel" aria-labelledby="cmp-h">
          <h3 id="cmp-h">Model comparison</h3>
          <p className="sub">Chosen by validation MAE. Test columns are shown for reference only.</p>
          <div className="table-scroll" style={{ maxHeight: 'none' }}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col" className="num">
                    Val MAE
                  </th>
                  <th scope="col" className="num">
                    Test MAE
                  </th>
                  <th scope="col" className="num">
                    Test RMSE
                  </th>
                  <th scope="col" className="num">
                    Test R²
                  </th>
                </tr>
              </thead>
              <tbody>
                {ev.comparison.map((c) => (
                  <tr key={c.family} className={c.selected ? 'selected' : undefined}>
                    <th scope="row" style={{ fontWeight: c.selected ? 650 : 450 }}>
                      {c.family === 'baseline' ? 'Median baseline' : c.family === 'ridge' ? 'Ridge regression' : 'Gradient-boosted trees'}
                      {c.selected && ' (selected)'}
                      <div className="cell-sub">{c.label}</div>
                    </th>
                    <td className="num">{fmtNum(c.validation.mae, 2)}</td>
                    <td className="num">{fmtNum(c.test.mae, 2)}</td>
                    <td className="num">{fmtNum(c.test.rmse, 2)}</td>
                    <td className="num">{fmtNum(c.test.r2, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="table-view">
            <summary>All {ev.trials.length} configurations tried</summary>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Configuration</th>
                    <th scope="col" className="num">
                      Validation MAE
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ev.trials.map((t) => (
                    <tr key={t.label}>
                      <td>{t.label}</td>
                      <td className="num">{fmtNum(t.validationMae, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="small muted" style={{ marginTop: 10 }}>
            Features ({spec.features.length}): {spec.features.map(label).join(', ')}. Preprocessing was fitted on the training split only. Full details are in the{' '}
            <Link to="/method#model">model card</Link>.
          </p>
        </section>
        <ActualVsPredicted ev={ev} scheme={scheme} />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <BandErrors ev={ev} scheme={scheme} />
        <Residuals ev={ev} scheme={scheme} />
      </div>
      <Importance ev={ev} scheme={scheme} />
    </section>
  )
}

function ActualVsPredicted({ ev, scheme }: { ev: ModelEval; scheme: string }) {
  const { actualBins, predictedBinWidth: w, counts } = ev.actualVsPredicted
  const cells = counts.flatMap((row, a) => row.map((n, p) => ({ actual: actualBins[a], p1: p * w, p2: (p + 1) * w, n }))).filter((c) => c.n > 0)
  const spread = predictionSpread(counts, w)
  return (
    <section className="panel" aria-labelledby="avp-h">
      <h3 id="avp-h">Actual vs predicted</h3>
      <p className="sub">
        All {fmtInt(ev.testRows)} test tracks, binned: rows are observed popularity buckets, columns are 2-point prediction bins. Darker means more tracks.
      </p>
      <Chart
        label="Heatmap of observed popularity bucket against predicted popularity for the test split"
        deps={[scheme]}
        caption={`90% of test predictions fall between ${spread[0]} and ${spread[1]}, while observed scores span 0–100. That is why errors are largest at both ends.`}
        render={(width) =>
          Plot.plot({
            ...plotBase(width),
            height: 340,
            marginLeft: 58,
            marginBottom: 40,
            x: { domain: [0, 100], label: 'Predicted popularity', grid: false },
            y: { domain: actualBins.slice().reverse(), label: 'Observed popularity' },
            color: { type: 'sqrt', range: [cssVar('--seq-low'), cssVar('--seq-high')], legend: true, label: 'Test tracks', width: 240 },
            marks: [
              Plot.rect(cells, {
                x1: 'p1',
                x2: 'p2',
                y: 'actual',
                fill: 'n',
                inset: 0.5,
                tip: { format: { x1: false, x2: false, fill: (v: number) => fmtInt(v), y: true }, channels: { predicted: (d: { p1: number; p2: number }) => `${d.p1}–${d.p2}` } } as never,
              }),
            ],
          })
        }
        table={{
          columns: [
            { key: 'actual', label: 'Observed bucket' },
            { key: 'range', label: 'Predicted range' },
            { key: 'n', label: 'Tracks', numeric: true, format: (v) => fmtInt(v as number) },
          ],
          rows: cells.map((c) => ({ ...c, range: `${c.p1}–${c.p2}` })),
        }}
      />
    </section>
  )
}

/** 5th and 95th percentile of predictions, at bin resolution. */
function predictionSpread(counts: number[][], w: number): [number, number] {
  const cols = counts[0].map((_, p) => counts.reduce((a, row) => a + row[p], 0))
  const total = cols.reduce((a, b) => a + b, 0)
  let cum = 0
  let lo = 0
  let hi = 100
  for (let p = 0; p < cols.length; p++) {
    const before = cum
    cum += cols[p]
    if (before < total * 0.05 && cum >= total * 0.05) lo = p * w
    if (before < total * 0.95 && cum >= total * 0.95) hi = (p + 1) * w
  }
  return [lo, hi]
}

function BandErrors({ ev, scheme }: { ev: ModelEval; scheme: string }) {
  const rows = ev.bands.flatMap((b) => [
    { band: b.band, who: 'Model', mae: b.mae, n: b.n },
    { band: b.band, who: 'Median baseline', mae: b.baselineMae, n: b.n },
  ])
  const colors = { Model: cssVar('--series-1'), 'Median baseline': cssVar('--neutral-mark') }
  return (
    <section className="panel" aria-labelledby="band-h">
      <h3 id="band-h">Error by observed popularity band</h3>
      <p className="sub">Mean absolute error on the test split. Sample size per band is under each label.</p>
      <Chart
        label="Grouped bar chart of model and baseline MAE by observed popularity band"
        deps={[scheme]}
        legend={Object.entries(colors).map(([k, c]) => ({ label: k, color: c }))}
        render={(width) =>
          Plot.plot({
            ...plotBase(width),
            height: 280,
            marginBottom: 48,
            marginLeft: 44,
            fx: { label: null, domain: ev.bands.map((b) => b.band), tickFormat: (b: string) => `${b}\nn=${fmtInt(ev.bands.find((x) => x.band === b)!.n)}`, padding: 0.15 },
            x: { axis: null, domain: Object.keys(colors) },
            y: { label: 'MAE (points)', grid: true },
            color: { domain: Object.keys(colors), range: Object.values(colors) },
            marks: [
              Plot.barY(rows, { fx: 'band', x: 'who', y: 'mae', fill: 'who', ry2: 3, insetLeft: 1, insetRight: 1, tip: { format: { y: (v: number) => fmtNum(v, 1), fx: true, x: true, fill: false } } }),
              Plot.ruleY([0], { stroke: cssVar('--border-strong') }),
            ],
          })
        }
        table={{
          columns: [
            { key: 'band', label: 'Observed popularity' },
            { key: 'n', label: 'Test tracks', numeric: true, format: (v) => fmtInt(v as number) },
            { key: 'mae', label: 'Model MAE', numeric: true, format: (v) => fmtNum(v as number, 1) },
            { key: 'baselineMae', label: 'Baseline MAE', numeric: true, format: (v) => fmtNum(v as number, 1) },
            { key: 'meanPredicted', label: 'Mean prediction', numeric: true, format: (v) => fmtNum(v as number, 1) },
          ],
          rows: ev.bands,
        }}
      />
    </section>
  )
}

function Residuals({ ev, scheme }: { ev: ModelEval; scheme: string }) {
  const { edges, counts } = ev.residuals
  const bins = counts.map((n, i) => ({ x1: edges[i], x2: edges[i + 1], n })).filter((b) => b.x2 > -70 && b.x1 < 80)
  return (
    <section className="panel" aria-labelledby="res-h">
      <h3 id="res-h">Residuals</h3>
      <p className="sub">
        Observed − predicted, 2-point bins, test split. Median {fmtNum(ev.residuals.median, 1)}, mean {fmtNum(ev.residuals.mean, 1)}. Left of zero means the model
        over-estimated.
      </p>
      <Chart
        label="Histogram of residuals on the test split"
        deps={[scheme]}
        render={(width) =>
          Plot.plot({
            ...plotBase(width),
            height: 280,
            marginLeft: 48,
            x: { label: 'Residual (points)' },
            y: { label: 'Test tracks', grid: true },
            marks: [
              Plot.rectY(bins, { x1: 'x1', x2: 'x2', y: 'n', fill: cssVar('--series-1'), insetLeft: 0.5, insetRight: 0.5, ry2: 2, tip: { format: { y: (v: number) => fmtInt(v) } } }),
              Plot.ruleX([0], { stroke: cssVar('--text-secondary'), strokeWidth: 1.5 }),
              Plot.ruleY([0], { stroke: cssVar('--border-strong') }),
            ],
          })
        }
        caption={`The ${fmtInt(ev.bands[0].n)} test tracks that score 0 have a mean prediction of ${fmtNum(ev.bands[0].meanPredicted, 1)}, so they form the cluster of residuals near −${fmtNum(ev.bands[0].meanPredicted, 0)}.`}
        table={{
          columns: [
            { key: 'range', label: 'Residual range' },
            { key: 'n', label: 'Test tracks', numeric: true, format: (v) => fmtInt(v as number) },
          ],
          rows: counts.map((n, i) => ({ range: `${edges[i]} to ${edges[i + 1]}`, n })).filter((r) => r.n > 0),
        }}
      />
    </section>
  )
}

function Importance({ ev, scheme }: { ev: ModelEval; scheme: string }) {
  const rows = ev.importance.rows.map((r) => ({ ...r, name: label(r.feature), lo: r.maeIncrease - r.std, hi: r.maeIncrease + r.std }))
  return (
    <section className="panel" aria-labelledby="imp-h" style={{ marginTop: 16 }}>
      <h3 id="imp-h">Global feature importance</h3>
      <p className="sub">
        Increase in test MAE when one feature is randomly shuffled (permutation importance, 5 repeats; lines show ± one standard deviation). It shows how much the model's
        predictions rely on each feature, not what causes popularity.
      </p>
      <Chart
        label="Bar chart of permutation importance by feature"
        deps={[scheme]}
        render={(width) =>
          Plot.plot({
            ...plotBase(width),
            height: rows.length * 24 + 50,
            marginLeft: 130,
            marginRight: 50,
            x: { label: 'MAE increase when shuffled (points)', grid: true },
            y: { domain: rows.map((r) => r.name), label: null },
            marks: [
              Plot.barX(rows, { y: 'name', x: 'maeIncrease', fill: cssVar('--series-1'), rx2: 3, insetTop: 4, insetBottom: 4, tip: { format: { x: (v: number) => fmtNum(v, 3), y: true } } }),
              Plot.ruleY(rows, { y: 'name', x1: 'lo', x2: 'hi', stroke: cssVar('--text-secondary') }),
              Plot.text(rows, { y: 'name', x: 'hi', text: (d: { maeIncrease: number }) => fmtNum(d.maeIncrease, 2), dx: 6, textAnchor: 'start', fill: cssVar('--text-secondary') }),
              Plot.ruleX([0], { stroke: cssVar('--border-strong') }),
            ],
          })
        }
        table={{
          columns: [
            { key: 'name', label: 'Feature' },
            { key: 'maeIncrease', label: 'MAE increase', numeric: true, format: (v) => fmtNum(v as number, 3) },
            { key: 'std', label: 'Std', numeric: true, format: (v) => fmtNum(v as number, 3) },
          ],
          rows,
        }}
      />
    </section>
  )
}
