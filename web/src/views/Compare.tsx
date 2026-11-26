import * as Plot from '@observablehq/plot'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Chart } from '../components/Chart'
import { ErrorBox, Loading, StatCard } from '../components/ui'
import { cssVar, plotBase, useColorScheme } from '../lib/chartTheme'
import { genreCohorts, winProbability } from '../lib/cohorts'
import { loadGenres, loadOverview } from '../lib/data'
import { fmtInt, fmtNum, fmtPct, label } from '../lib/format'
import { decodeOverview, medianFromCounts, popularityBuckets } from '../lib/overview'
import { UNIT_FEATURES, type GenresDoc, type OverviewDoc } from '../lib/types'
import { useAsync } from '../lib/useAsync'

import { COMPARISONS, compareUrl } from '../lib/compareLinks'

export default function Compare() {
  const overview = useAsync(loadOverview)
  const genres = useAsync(loadGenres)
  if (overview.error || genres.error) return <ErrorBox error={(overview.error ?? genres.error)!} />
  if (!overview.data || !genres.data) return <Loading what="genre comparison data" />
  if (overview.data.buildId !== genres.data.buildId || overview.data.dataSha256 !== genres.data.dataSha256) {
    return <ErrorBox error={new Error('Comparison data came from different builds. Reload the page to try again.')} />
  }
  return <Comparison overview={overview.data} profiles={genres.data} />
}

function Comparison({ overview, profiles }: { overview: OverviewDoc; profiles: GenresDoc }) {
  const [params, setParams] = useSearchParams()
  const scheme = useColorScheme()
  const a = overview.genres.includes(params.get('a') ?? '') ? params.get('a')! : COMPARISONS[0].a
  const b = overview.genres.includes(params.get('b') ?? '') ? params.get('b')! : COMPARISONS[0].b
  const excludeZero = params.get('zero') === 'hide'
  const updatePair = (first: string, second: string) => setParams({ a: first, b: second, ...(excludeZero ? { zero: 'hide' } : {}) })
  const decoded = useMemo(() => decodeOverview(overview), [overview])
  const [left, shared, right] = useMemo(
    () => genreCohorts(decoded, overview.genres.indexOf(a), overview.genres.indexOf(b)),
    [decoded, overview, a, b],
  )
  const colors = ['--series-1', '--series-3', '--series-2'].map(cssVar)
  const groups = [
    { name: `${a} only`, ...left },
    { name: 'Both genres', ...shared },
    { name: `${b} only`, ...right },
  ]
  const total = left.n + shared.n + right.n
  const scoreHistogram = (histogram: number[]) => excludeZero ? [0, ...histogram.slice(1)] : histogram
  const probability = winProbability(scoreHistogram(left.histogram), scoreHistogram(right.histogram))
  const buckets = popularityBuckets(left.histogram).filter((bin) => !excludeZero || bin.lo > 0).map((bin) => bin.label)
  const distribution = groups.flatMap((group) => {
    const count = group.n - (excludeZero ? group.histogram[0] : 0)
    if (!count) return []
    return popularityBuckets(group.histogram).filter((bin) => !excludeZero || bin.lo > 0).map((bin) => ({
      score: bin.label, group: group.name, share: bin.n / count, count: bin.n,
    }))
  })
  const profileA = profiles.genres.find((genre) => genre.name === a)!
  const profileB = profiles.genres.find((genre) => genre.name === b)!
  const features = UNIT_FEATURES.map((f) => ({
    name: label(f), a: profileA.features[f].median, b: profileB.features[f].median,
    spreadA: profileA.features[f], spreadB: profileB.features[f],
  })).sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b))

  return (
    <>
      <div className="page-head">
        <h1>Compare two genres</h1>
        <p className="lead">See what each label contributes on its own, what the labels share, and how the popularity distributions change when you separate them.</p>
      </div>
      <section className="panel compare-controls" aria-label="Comparison controls">
        <div className="compare-pickers">
          <label>First genre
            <select value={a} onChange={(e) => updatePair(e.target.value, b)}>
              {overview.genres.map((genre) => <option key={genre} disabled={genre === b}>{genre}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => updatePair(b, a)}>Swap genres</button>
          <label>Second genre
            <select value={b} onChange={(e) => updatePair(a, e.target.value)}>
              {overview.genres.map((genre) => <option key={genre} disabled={genre === a}>{genre}</option>)}
            </select>
          </label>
        </div>
        <div className="compare-presets">
          {COMPARISONS.map((item) => <Link key={item.a} to={compareUrl(item.a, item.b)}>{item.title}</Link>)}
        </div>
      </section>
      {a === b ? <p role="status" className="panel">Choose two different genres to compare.</p> : (
        <>
          <section className="panel compare-section" aria-labelledby="cohort-title">
            <h2 id="cohort-title">How much do the labels overlap?</h2>
            <div className="cohort-bar" aria-hidden="true">
              {groups.map((group, i) => group.n > 0 && <span key={group.name} style={{ flexGrow: group.n, background: colors[i] }} />)}
            </div>
            <div className="grid grid-cards">
              {groups.map((group, i) => (
                <StatCard key={group.name} label={group.name} value={<span style={{ borderBottom: `3px solid ${colors[i]}` }}>{fmtInt(group.n)}</span>}
                  note={group.n ? `Median popularity ${fmtNum(medianFromCounts(group.histogram)!, 1)} · ${fmtPct(group.histogram[0] / group.n)} score zero` : 'No tracks in this group'} />
              ))}
            </div>
            <p className="sub cohort-note" aria-live="polite">
              {fmtPct(shared.n / total)} of the {fmtInt(total)} distinct tracks across these two labels are tagged with both.
              {shared.n === total ? ' These labels identify the same tracks in this snapshot.' : ''}
            </p>
          </section>
          <section className="panel compare-section" aria-labelledby="distribution-title">
            <h2 id="distribution-title">Where do the popularity scores land?</h2>
            <label className="cohort-toggle">
              <input type="checkbox" checked={excludeZero} onChange={(e) => setParams({ a, b, ...(e.target.checked ? { zero: 'hide' } : {}) })} />
              Compare nonzero scores only
            </label>
            <p className="sub">
              {probability === null
                ? 'Both genres need tracks unique to their label for a head-to-head comparison.'
                : `A randomly drawn ${a}-only track ranks above a ${b}-only track ${fmtPct(probability)} of the time when ties count as half a win.`}
            </p>
            <Chart
              label="Popularity distribution by label membership"
              deps={[distribution, scheme]}
              legend={groups.map((g, i) => ({ label: g.name, color: colors[i], shape: 'line' }))}
              render={(width) => Plot.plot({
                ...plotBase(width),
                height: 265,
                x: { label: 'Recorded popularity', domain: buckets, tickRotate: width < 650 ? -55 : 0 },
                y: { grid: true, label: 'Share within cohort', percent: true },
                color: { domain: groups.map((g) => g.name), range: colors },
                marks: [
                  Plot.ruleY([0]),
                  Plot.line(distribution, { x: 'score', y: 'share', stroke: 'group', z: 'group' }),
                  Plot.dot(distribution, { x: 'score', y: 'share', fill: 'group', title: (d) => `${d.group}: ${d.count} tracks, ${fmtPct(d.share)}` }),
                ],
              })}
              caption={excludeZero ? "Shares are recalculated over nonzero scores. The overlap counts above still include all tracks." : "Zero has its own bucket. The remaining buckets each cover five score points."}
              table={{ columns: [{ key: 'score', label: 'Score' }, { key: 'group', label: 'Cohort' }, { key: 'count', label: 'Tracks', numeric: true }, { key: 'share', label: 'Share', format: (v) => fmtPct(Number(v)) }], rows: distribution }}
            />
          </section>
          <section className="panel compare-section" aria-labelledby="fingerprint-title">
            <h2 id="fingerprint-title">What sounds different?</h2>
            <p className="sub">Each range contains the middle half of tracks in that label, including shared tracks. Dots mark the medians.</p>
            <div className="chart-legend"><span><i className="swatch" style={{ background: colors[0] }} />{a}</span><span><i className="swatch" style={{ background: colors[2] }} />{b}</span></div>
            <div className="fingerprints">
              {features.map((feature) => (
                <div key={feature.name} className="fingerprint-row">
                  <strong>{feature.name}</strong>
                  {[{ genre: a, spread: feature.spreadA, color: colors[0] }, { genre: b, spread: feature.spreadB, color: colors[2] }].map(({ genre, spread, color }) => (
                    <div key={genre} className="fingerprint-track" aria-label={`${genre}: ${fmtNum(spread.q1, 2)} to ${fmtNum(spread.q3, 2)}, median ${fmtNum(spread.median, 2)}`}>
                      <span style={{ left: `${spread.q1 * 100}%`, width: `${(spread.q3 - spread.q1) * 100}%`, background: color }} />
                      <i style={{ left: `${spread.median * 100}%`, background: color }} />
                    </div>
                  ))}
                  <small>{fmtNum(feature.a, 2)} / {fmtNum(feature.b, 2)}</small>
                </div>
              ))}
            </div>
            <p className="sub cohort-note"><Link to={`/overview?${new URLSearchParams({ genres: `${a},${b}` })}`}>Open both genres in the overview</Link></p>
          </section>
        </>
      )}
    </>
  )
}
