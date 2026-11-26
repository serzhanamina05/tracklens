const int = new Intl.NumberFormat('en-US')

export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : int.format(Math.round(n)))
export const fmtNum = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
export const fmtPct = (share: number | null | undefined, digits = 1) =>
  share === null || share === undefined ? '—' : `${(share * 100).toFixed(digits)}%`

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const KEY_NAMES = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B']

export const FEATURE_LABELS: Record<string, string> = {
  danceability: 'Danceability',
  energy: 'Energy',
  speechiness: 'Speechiness',
  acousticness: 'Acousticness',
  instrumentalness: 'Instrumentalness',
  liveness: 'Liveness',
  valence: 'Valence',
  tempo: 'Tempo (BPM)',
  loudness: 'Loudness (dB)',
  duration_ms: 'Duration',
  duration_s: 'Duration',
  explicit: 'Explicit',
  key: 'Key',
  mode: 'Mode',
  time_signature: 'Time signature',
  popularity: 'Popularity',
}

export const label = (f: string) => FEATURE_LABELS[f] ?? f
