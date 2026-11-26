import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { ErrorBox, Loading } from '../components/ui'
import { useAsync } from '../lib/useAsync'
import { FULL_MODE, loadMeta, loadModel, loadModelEval, loadSimilarity } from '../lib/data'
import { fmtInt, fmtNum, label } from '../lib/format'

export default function DataNotes() {
  const meta = useAsync(loadMeta)
  const ev = useAsync(loadModelEval)
  const model = useAsync(loadModel)
  const sim = useAsync(loadSimilarity)
  const { hash } = useLocation()
  const ready = meta.data && ev.data && model.data && sim.data
  useEffect(() => {
    if (ready && hash) document.getElementById(hash.slice(1))?.scrollIntoView()
  }, [ready, hash])
  const err = meta.error ?? ev.error ?? model.error ?? sim.error
  if (err) return <ErrorBox error={err} />
  if (!meta.data || !ev.data || !model.data || !sim.data) return <Loading what="data notes" />
  const p = meta.data.profile
  const r = p.rules
  const e = ev.data
  const m = model.data

  return (
    <div className="prose">
      <div className="page-head">
        <h1>Data and method</h1>
        <p className="lead">What the file contains, how it was cleaned, what each chart counts, and what the data cannot tell you.</p>
      </div>

      <section className="panel" aria-labelledby="profile-h">
        <h2 id="profile-h">Profile of the supplied CSV</h2>
        <div className="table-scroll" style={{ maxHeight: 'none' }}>
        <table className="data">
          <tbody>
            {[
              ['Rows', fmtInt(p.rows)],
              ['Unique track IDs', fmtInt(p.unique_track_ids)],
              ['Genre labels', fmtInt(p.genres)],
              ['Missing values', Object.entries(p.missing_values).map(([k, v]) => `${k}: ${v}`).join(', ') + ' (all on the same row)'],
              ['IDs on more than one row', fmtInt(p.ids_on_multiple_rows)],
              ['Exact repeats of a track–genre pair', fmtInt(r.repeated_track_genre_pairs_dropped)],
              ['Unique track–genre memberships', fmtInt(p.memberships)],
              ['Tracks listed under 2 or more genres', `${fmtInt(p.tracks_in_multiple_genres)} (up to ${p.max_genres_per_track})`],
              ['IDs whose popularity differs between rows', `${fmtInt(r.popularity_conflict_ids)} (spread up to ${r.popularity_conflict_max_spread} points); no other column ever differs`],
              ['Popularity = 0: rows / unique tracks / memberships', `${fmtInt(p.zero_popularity_rows)} / ${fmtInt(p.zero_popularity_tracks)} / ${fmtInt(p.zero_popularity_memberships)}`],
              ['Duplicate-recording groups', `${fmtInt(p.duplicate_recording_groups)} groups covering ${fmtInt(p.tracks_in_duplicate_recording_groups)} tracks`],
            ].map(([k, v]) => (
              <tr key={k}>
                <th scope="row" style={{ fontWeight: 500 }}>
                  {k}
                </th>
                <td className="num">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="rules-h">
        <h2 id="rules-h">Cleaning rules</h2>
        <ol>
          <li>Exact repeats of a (track, genre) pair are dropped, keeping the first row.</li>
          <li>
            The file becomes two tables: one row per unique track ({fmtInt(p.unique_track_ids)}) and a track-to-genre mapping ({fmtInt(p.memberships)} memberships). Every
            genre membership is kept.
          </li>
          <li>
            When an ID's rows disagree on popularity, the canonical score is the median of its rows, rounded half up. This rule is deterministic and independent of row order.
            {` ${fmtInt(r.popularity_conflict_ids_with_a_zero_row)}`} of the {fmtInt(r.popularity_conflict_ids)} conflicting IDs have a zero on at least one row.
          </li>
          <li>Zero is a valid score. It is kept everywhere and shown as its own bucket. Zero-score tracks are among the model's largest errors (see the Model Lab band chart).</li>
          <li>
            {r.model_invalid_tracks} track has a 0 ms duration and no title, artist or album. It stays in the counts but is excluded from the model and similarity search.
          </li>
        </ol>
      </section>

      <section className="panel" aria-labelledby="denom-h">
        <h2 id="denom-h">What each chart counts</h2>
        <ul>
          <li>
            <strong>Unique tracks</strong>: overview cards, the popularity histogram{FULL_MODE ? ' and the Track Explorer' : ''}. A track in several selected genres counts once.
          </li>
          <li>
            <strong>Track–genre memberships</strong>: the genre comparison, the feature comparison and the genre explorer. Each genre counts its own tracks.
          </li>
          <li>
            <strong>Held-out test tracks</strong>: every metric and plot in the Model Lab ({fmtInt(e.testRows)} tracks).
          </li>
        </ul>
      </section>

      <section className="panel" aria-labelledby="limits-h">
        <h2 id="limits-h">Sampling and snapshot limitations</h2>
        <ul>
          <li>The file has about 1,000 rows per genre label. Genre sizes reflect how the sample was collected, not how common each genre is.</li>
          <li>Popularity is a single snapshot score with no collection date. The file has no release dates, play counts or listener data, so TrackLens makes no claims about trends or listening behaviour.</li>
          <li>Genre labels overlap heavily. For example, every songwriter track is also a singer-songwriter track.</li>
          <li>Everything here is a descriptive association within this sample, not a cause.</li>
        </ul>
      </section>

      <section className="panel" id="model" aria-labelledby="model-h">
        <h2 id="model-h">Model card (summary)</h2>
        <ul>
          <li>
            Task: regress the popularity score from {m.features.length} audio features ({m.features.map(label).join(', ')}). Identifiers, text, genre and target-derived fields are
            excluded.
          </li>
          <li>
            Split: {e.split.method}, seed {e.split.seed}. Train {fmtInt(e.split.rows.train)}, validation {fmtInt(e.split.rows.validation)}, test {fmtInt(e.split.rows.test)}. IDs that share
            a normalised artist and title, or identical audio features, are kept on one side of the split. Covers, remasters with changed titles and versions credited differently
            can still cross: {fmtInt(e.split.testTracksWithTitleInTrain)} test tracks share a title with a training track regardless of artist
            credit.
          </li>
          <li>
            Candidates: a median baseline, ridge regression and histogram gradient-boosted trees, {e.trials.length} configurations in total. Selection rule: {e.selectionRule}.
          </li>
          <li>
            Selected: {e.selected}. Test MAE {fmtNum(e.test.mae, 2)} vs {fmtNum(e.baselineTest.mae, 2)} for the baseline; RMSE {fmtNum(e.test.rmse, 2)}; R² {fmtNum(e.test.r2, 3)}.
          </li>
          <li>
            Export: the trees, feature order, validation bounds and the 0–100 clipping rule are in <code>model.json</code>. The browser evaluates the same file; parity tests compare it
            with scikit-learn to within 1e-9 on fixed inputs, including bound edges and values that sit exactly on split thresholds.
          </li>
        </ul>
      </section>

      <section className="panel" aria-labelledby="sim-h">
        <h2 id="sim-h">Similarity method</h2>
        <p>
          Metric: {sim.data.metric} over {sim.data.features.map(label).join(', ')}, with a {sim.data.scaler.replace('StandardScaler (z-score)', 'z-score scaler')}. Excluded:{' '}
          {sim.data.excluded.join(', ')}. Results describe how close the measured audio features are, not listener preference.
        </p>
      </section>

      <section className="panel" id="publication" aria-labelledby="pub-h">
        <h2 id="pub-h">Publication and attribution</h2>
        <p>
          This site is the <strong>{FULL_MODE ? 'local full-data' : 'public aggregate'}</strong> edition. {meta.data.publication.reason}
        </p>
        <p>
          Published files: genre-level statistics, counts per (genre combination, popularity score, 5-second duration bin), scaler and model parameters, held-out evaluation
          summaries, and synthetic test fixtures. The raw CSV, track IDs, titles, artists, albums and per-track features stay in git-ignored local folders.
        </p>
        <p>
          The supplied CSV matches the schema, row count and checked records of the{' '}
          <a href="https://www.kaggle.com/datasets/maharshipandya/-spotify-tracks-dataset/data">Spotify Tracks Dataset published by Maharshi Pandya</a>.
          Spotify is the source of the underlying metadata and audio features. Dataset fingerprint: SHA-256 {meta.data.dataSha256.slice(0, 12)}…
        </p>
      </section>
    </div>
  )
}
