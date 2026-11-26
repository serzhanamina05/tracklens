import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { musicKey, rankArtists, type CatalogTrack } from '../lib/musicCatalog'
import { loadGenres } from '../lib/data'
import { useAsync } from '../lib/useAsync'
import { fmtInt, fmtNum } from '../lib/format'

let sessionTracks: CatalogTrack[] = []
async function readCatalog(file: File): Promise<CatalogTrack[]> {
  const worker = new Worker(new URL('../lib/musicImport.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<{ tracks?: CatalogTrack[]; error?: string }>) => {
        if (data.tracks) resolve(data.tracks)
        else reject(new Error(data.error ?? 'Could not read this CSV.'))
      }
      worker.onerror = () => reject(new Error('The background CSV reader failed.'))
      worker.postMessage(file)
    })
  } finally {
    worker.terminate()
  }
}

function GenreHighlights() {
  const data = useAsync(loadGenres)
  const top = data.data?.genres.slice().sort((a, b) => b.popularity.median - a.popularity.median || a.name.localeCompare(b.name)).slice(0, 6)
  if (!top?.length) return null
  return (
    <section className="panel" aria-labelledby="genre-highlights">
      <h2 id="genre-highlights">Genres with the highest median song scores</h2>
      <p className="sub">Based on the songs in this dataset. A song can belong to more than one genre.</p>
      <div className="discovery-links">
        {top.map((item) => (
          <Link key={item.name} to={`/overview?${new URLSearchParams({ genres: item.name })}`}>
            <span>{item.name}</span><span>{fmtNum(item.popularity.median, 1)} / 100</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

export default function Music() {
  const [tracks, setTracks] = useState(sessionTracks)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'songs' | 'artists'>('songs')
  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState('')
  const [artist, setArtist] = useState('')
  const [selected, setSelected] = useState<CatalogTrack | null>(null)
  const [limit, setLimit] = useState(20)
  const genres = useMemo(() => [...new Set(tracks.flatMap((track) => track.genres))].sort(), [tracks])
  const cohort = useMemo(() => genre ? tracks.filter((track) => track.genres.includes(genre)) : tracks, [tracks, genre])
  const artists = useMemo(() => tab === 'artists' || artist ? rankArtists(cohort) : [], [cohort, tab, artist])
  const profile = artists.find((item) => item.name === artist)
  const term = musicKey(query)
  const searchableSongs = profile?.songs ?? cohort
  const songs = tab === 'songs' && term ? searchableSongs.filter((track) =>
    musicKey([track.title, track.album, ...track.artists].join(' ')).includes(term)
  ) : searchableSongs
  const ranked = tab === 'artists' ? artists.filter((item) =>
    term ? musicKey(item.name).includes(term) : item.songs.length >= 5
  ) : []
  const results = tab === 'artists' ? ranked.length : songs.length

  async function importFile(file: File) {
    setLoading(true)
    setError('')
    try {
      const loaded = await readCatalog(file)
      sessionTracks = loaded
      setTracks(loaded)
      setGenre('')
      setArtist('')
      setQuery('')
      setSelected(null)
      setLimit(20)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read this CSV.')
    } finally {
      setLoading(false)
    }
  }

  function openArtist(name: string) {
    setArtist(name)
    setQuery('')
    setTab('songs')
    setSelected(null)
    setLimit(20)
  }

  return (
    <>
      <div className="page-head discovery-head">
        <h1>Discover songs and artists</h1>
        <p className="lead">Find a favorite artist, see which songs scored highest, or explore the top tracks in a genre.</p>
        <label className="catalog-import">
          <strong>{tracks.length ? 'Replace dataset' : 'Open your dataset.csv'}</strong>
          <input type="file" accept=".csv,text/csv" disabled={loading} onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void importFile(file)
          }} />
        </label>
        <p className="small muted">Your file is read in this browser. <Link to="/overview">Explore the genre dashboard</Link> without a file.</p>
        {loading && <p role="status">Reading songs and grouping repeated tracks…</p>}
        {error && <p role="alert">{error}</p>}
      </div>
      {!tracks.length && <GenreHighlights />}
      {tracks.length > 0 && (
        <section className="panel" aria-label="Music catalog">
          <div className="compare-pickers catalog-controls">
            <label>Search
              <input type="search" placeholder={tab === 'songs' ? 'Song, artist or album' : 'Artist name'} value={query} onChange={(event) => {
                setQuery(event.target.value)
                setLimit(20)
                setSelected(null)
              }} />
            </label>
            <div className="catalog-genre"><label htmlFor="catalog-genre">Genre</label>
              <select id="catalog-genre" value={genre} onChange={(event) => {
                setGenre(event.target.value)
                setArtist('')
                setSelected(null)
                setLimit(20)
              }}>
                <option value="">All genres</option>
                {genres.map((name) => <option key={name}>{name}</option>)}
              </select>
            </div>
          </div>
          <div className="catalog-tabs" aria-label="Result type">
            {(['songs', 'artists'] as const).map((name) => (
              <button key={name} type="button" aria-pressed={tab === name} onClick={() => {
                setTab(name)
                setQuery('')
                setArtist('')
                setSelected(null)
                setLimit(20)
              }}>{name === 'songs' ? 'Top songs' : 'Top artists'}</button>
            ))}
          </div>
          {profile && (
            <div className="catalog-profile">
              <h2>{profile.name}</h2>
              <p>{fmtInt(profile.songs.length)} songs · Median song score {fmtNum(profile.median, 1)} / 100</p>
              <button type="button" onClick={() => { setArtist(''); setSelected(null); setLimit(20) }}>Back to all songs</button>
            </div>
          )}
          <p className="sub" aria-live="polite">
            {fmtInt(results)} {tab === 'artists' ? 'artists' : 'songs'} · {tab === 'artists'
              ? 'Ranked by median song score. The leaderboard starts at five tracks per artist. Search includes smaller catalogs.'
              : 'Sorted by recorded popularity (0–100). Scores reflect this dataset snapshot.'}
          </p>
          {results === 0 && <p>No matches. Try another name or choose a different genre.</p>}
          {tab === 'artists' ? (
            <ol className="catalog-list">
              {ranked.slice(0, limit).map((item) => (
                <li key={item.name}>
                  <button type="button" className="catalog-row" onClick={() => openArtist(item.name)}>
                    <span><strong>{item.name}</strong><small>{fmtInt(item.songs.length)} songs</small></span>
                    <span className="catalog-score">{fmtNum(item.median, 1)}<small>Median</small></span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <ol className="catalog-list">
              {songs.slice(0, limit).map((track) => (
                <li key={track.id}>
                  <button type="button" className="catalog-row" aria-expanded={selected?.id === track.id} onClick={() => setSelected(selected?.id === track.id ? null : track)}>
                    <span><strong>{track.title}</strong><small>{track.artists.join(', ') || 'Unknown artist'}</small></span>
                    <span className="catalog-score">{track.score}<small>/ 100</small></span>
                  </button>
                  {selected?.id === track.id && (
                    <div className="catalog-detail">
                      {track.album && <p>Album · {track.album}</p>}
                      <p>Genres · {track.genres.join(', ')}</p>
                      <div className="catalog-tabs">
                        {track.artists.map((name) => <button key={name} type="button" onClick={() => openArtist(name)}>Explore {name}</button>)}
                        {/^[a-zA-Z0-9]{22}$/.test(track.id) && <a href={`https://open.spotify.com/track/${track.id}`} target="_blank" rel="noreferrer">Open on Spotify ↗</a>}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          {results > limit && <button type="button" onClick={() => setLimit(limit + 20)}>Show 20 more</button>}
        </section>
      )}
    </>
  )
}
