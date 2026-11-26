import Papa from 'papaparse'
import { catalogTracks } from './musicCatalog'

const required = ['track_id', 'track_name', 'artists', 'album_name', 'popularity', 'track_genre']

self.onmessage = async ({ data: file }: MessageEvent<File>) => {
  try {
    const { data, errors, meta } = Papa.parse<Record<string, string>>(await file.text(), {
      header: true, skipEmptyLines: 'greedy',
    })
    if (!required.every((field) => meta.fields?.includes(field))) {
      throw new Error('Choose the TrackLens dataset.csv. This file is missing required song or popularity columns.')
    }
    if (errors.length) throw new Error('The CSV contains malformed rows. Try the original dataset.csv.')
    const tracks = catalogTracks(data)
    if (!tracks.length) throw new Error('No songs with valid popularity scores were found.')
    self.postMessage({ tracks })
  } catch (cause) {
    self.postMessage({ error: cause instanceof Error ? cause.message : 'Could not read this CSV.' })
  }
}
