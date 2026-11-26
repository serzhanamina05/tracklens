import { FULL_MODE } from '../lib/data'
import GenreExplorer from './GenreExplorer'
import TrackExplorer from './TrackExplorer'

export default function Explorer() {
  return FULL_MODE ? <TrackExplorer /> : <GenreExplorer />
}
