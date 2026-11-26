import { expect, it } from 'vitest'
import { catalogTracks, musicKey, rankArtists } from './musicCatalog'

it('uses one score per genre and preserves zero as a valid score', () => {
  const row = { track_id: '1', track_name: 'B', artists: 'A;C;A', popularity: '0', track_genre: 'pop' }
  const tracks = catalogTracks([
    row,
    { ...row, popularity: '100' },
    { ...row, popularity: '3', track_genre: 'rock' },
    { ...row, track_id: '2' },
    { ...row, track_id: '3', popularity: '' },
  ])
  expect(tracks.map((track) => track.score)).toEqual([2, 0])
  expect(tracks[0].genres).toEqual(['pop', 'rock'])
  expect(rankArtists(tracks).map((artist) => [artist.name, artist.songs.length, artist.median])).toEqual([
    ['A', 2, 1],
    ['C', 2, 1],
  ])
  expect(musicKey(' Beyoncé ')).toBe('beyonce')
})
