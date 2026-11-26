export interface CatalogTrack {
  id: string
  title: string
  artists: string[]
  album: string
  score: number
  genres: string[]
}

type CsvRow = Record<string, string | undefined>
export const musicKey = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim()

export function catalogTracks(rows: CsvRow[]): CatalogTrack[] {
  const tracks = new Map<string, { track: CatalogTrack; scores: Map<string, number> }>()
  for (const row of rows) {
    const id = row.track_id?.trim()
    const genre = row.track_genre?.trim()
    const score = Number(row.popularity)
    if (!id || !genre || !row.popularity?.trim() || !Number.isInteger(score) || score < 0 || score > 100) continue
    let entry = tracks.get(id)
    if (!entry) {
      entry = {
        track: {
          id, title: row.track_name?.trim() || 'Unknown title', album: row.album_name?.trim() || '',
          artists: [...new Set((row.artists ?? '').split(';').map((artist) => artist.trim()).filter(Boolean))],
          score, genres: [],
        },
        scores: new Map(),
      }
      tracks.set(id, entry)
    }
    if (!entry.scores.has(genre)) entry.scores.set(genre, score)
  }
  return [...tracks.values()].map(({ track, scores }) => ({
    ...track, genres: [...scores.keys()].sort(), score: Math.round(median([...scores.values()])),
  })).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}

function median(values: number[]) {
  values.sort((a, b) => a - b)
  return (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2
}

export function rankArtists(tracks: CatalogTrack[]) {
  const groups = new Map<string, CatalogTrack[]>()
  for (const track of tracks) {
    for (const artist of track.artists) {
      const group = groups.get(artist)
      if (group) group.push(track)
      else groups.set(artist, [track])
    }
  }
  return [...groups].map(([name, songs]) => ({
    name, songs, median: median(songs.map((song) => song.score)),
  })).sort((a, b) => b.median - a.median || b.songs.length - a.songs.length || a.name.localeCompare(b.name))
}
