import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Empty, ErrorBox, Loading, Select } from '../components/ui'
import { useAsync } from '../lib/useAsync'
import { TrackSearch } from '../components/TrackSearch'
import { FULL_MODE, loadGenres, loadSimilarity } from '../lib/data'
import { fmtNum, label } from '../lib/format'
import { similarTracks, trackDetail, type SimilarResult, type TrackRow } from '../lib/trackProtocol'
import type { SimilaritySpec } from '../lib/types'
import { centroidExplanation, explainNeighbor } from '../lib/explain'

export default function Similar() {
  const sim = useAsync(loadSimilarity)
  if (sim.error) return <ErrorBox error={sim.error} />
  if (!sim.data) return <Loading what="similarity settings" />
  return FULL_MODE ? <SimilarTracks sim={sim.data} /> : <SimilarGenres sim={sim.data} />
}

function Method({ sim }: { sim: SimilaritySpec }) {
  return (
    <section className="panel" style={{ marginTop: 16 }} aria-labelledby="method-h">
      <h2 id="method-h">How similarity is measured</h2>
      <ul className="small prose" style={{ paddingLeft: 18, margin: 0 }}>
        <li>
          Features ({sim.features.length}): {sim.features.map(label).join(', ')}. Each is z-scored with a {sim.scaler.replace(/^StandardScaler \(z-score\) /, '')} (
          {sim.fittedOn.toLocaleString('en-US')} tracks), so every feature has equal weight.
        </li>
        <li>Distance: Euclidean on the z-scores. Smaller means the measured audio features are closer.</li>
        <li>Not used: track identity, title, artist, album, popularity, genre, duration, key, mode and time signature.</li>
        <li>Similar audio features do not mean listeners who like one track will like the other.</li>
      </ul>
    </section>
  )
}

async function loadNeighbours(idx: string | null): Promise<{ query: TrackRow; res: SimilarResult } | null> {
  if (idx === null) return null
  const [query, res] = await Promise.all([trackDetail(Number(idx)), similarTracks(Number(idx), 10)])
  return { query, res }
}

function SimilarTracks({ sim }: { sim: SimilaritySpec }) {
  const [params, setParams] = useSearchParams()
  const idx = params.get('track')
  const result = useAsync(loadNeighbours, idx)
  const busy = idx !== null && result.loading
  const query = result.data?.query ?? null
  const res = result.data?.res ?? null

  return (
    <>
      <div className="page-head">
        <h1>Find Similar Tracks</h1>
        <p className="lead">Pick a track to list the ten tracks whose measured audio features are closest. The search runs in a background worker in your browser.</p>
      </div>
      <section className="panel">
        <TrackSearch label="Query track" onPick={(t) => setParams({ track: String(t.index) })} />
      </section>
      <section className="panel" style={{ marginTop: 16 }} aria-live="polite" aria-busy={busy}>
        {idx === null ? (
          <Empty>Search for a track above, or open one from the Track Explorer.</Empty>
        ) : result.error ? (
          <ErrorBox error={result.error} />
        ) : busy || !query || !res ? (
          <Loading what="nearest neighbours" />
        ) : !query.valid ? (
          <Empty>This track has invalid audio features (0 ms duration) and is excluded from similarity search.</Empty>
        ) : (
          <>
            <h2>
              Closest to “{query.name}” <span className="muted" style={{ fontWeight: 450 }}>· {query.artists}</span>
            </h2>
            <p className="sub">
              The query track and other IDs of the same recording are excluded, and each title–artist pair appears once.
            </p>
            <ol className="result-list">
              {res.map((n, i) => (
                <li key={n.index}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>
                      <span className="muted">{i + 1}.</span> <span className="cell-title">{n.track.name || 'Untitled'}</span>{' '}
                      <span className="muted">· {n.track.artists}</span>
                    </span>
                    <span className="row small" style={{ gap: 10 }}>
                      <span>popularity {n.track.popularity}</span>
                      <Link to={`/similar?track=${n.index}`}>Use as query</Link>
                    </span>
                  </div>
                  <div className="cell-sub">
                    {explainNeighbor(n)} Genres: {n.track.genres.join(', ')}.
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
      <Method sim={sim} />
    </>
  )
}

function SimilarGenres({ sim }: { sim: SimilaritySpec }) {
  const g = useAsync(loadGenres)
  const [genre, setGenre] = useState('acoustic')
  const current = useMemo(() => g.data?.genres.find((x) => x.name === genre), [g.data, genre])
  if (g.error) return <ErrorBox error={g.error} />
  if (!g.data || !current) return <Loading what="genre profiles" />
  const doc = g.data
  return (
    <>
      <div className="page-head">
        <h1>Similar Genres</h1>
        <p className="lead">Find the genres whose average audio features are closest to a chosen genre.</p>
      </div>
      <div className="notice" role="note">
        <h2 style={{ fontSize: '1rem' }}>Track-level similarity search is off in this public edition</h2>
        <p className="small" style={{ margin: 0 }}>
          Listing similar tracks would publish track titles, artists and per-track audio features, and redistribution rights for those records could not be confirmed. The same
          method runs at genre level below, using genre centroids. Run TrackLens locally with the CSV to search individual tracks (see the README).{' '}
          <Link to="/method#publication">Publication details</Link>.
        </p>
      </div>
      <section className="panel" style={{ marginTop: 16 }} aria-live="polite">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Select label="Genre" value={genre} options={doc.genres.map((x) => ({ value: x.name, label: x.name }))} onChange={setGenre} />
        </div>
        <h2 style={{ marginTop: 16 }}>Closest to {current.name}</h2>
        <p className="sub">Euclidean distance between genre centroids (mean z-scores over each genre's tracks).</p>
        <ol className="result-list">
          {current.neighbors.map((n, i) => {
            const other = doc.genres.find((x) => x.name === n.genre)!
            return (
              <li key={n.genre}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    <span className="muted">{i + 1}.</span>{' '}
                    <button type="button" className="link cell-title" onClick={() => setGenre(n.genre)}>
                      {n.genre}
                    </button>
                  </span>
                  <span className="small muted">distance {fmtNum(n.distance, 2)}</span>
                </div>
                <div className="cell-sub">{centroidExplanation(current, other, sim)}</div>
              </li>
            )
          })}
        </ol>
      </section>
      <Method sim={sim} />
    </>
  )
}
