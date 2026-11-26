import { useId, useState, type ReactNode } from 'react'

export function Loading({ what }: { what: string }) {
  return (
    <p className="muted" role="status">
      Loading {what}…
    </p>
  )
}

export function ErrorBox({ error }: { error: Error }) {
  return (
    <div className="notice" role="alert">
      <h3>Something failed to load</h3>
      <p className="small">{error.message}</p>
    </div>
  )
}

export function StatCard({ label, value, note }: { label: string; value: ReactNode; note: ReactNode }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="note">{note}</div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty" role="status">
      {children}
    </div>
  )
}

/** Multi-select for genres: a filterable text input backed by a datalist, with
 *  removable chips. Works with keyboard and screen readers without a custom
 *  listbox implementation. */
export function GenrePicker({
  genres,
  selected,
  onChange,
  max,
  label = 'Genres',
  help,
}: {
  genres: string[]
  selected: number[]
  onChange: (next: number[]) => void
  max?: number
  label?: string
  help?: string
}) {
  const id = useId()
  const [text, setText] = useState('')
  const full = max !== undefined && selected.length >= max
  const add = (value: string) => {
    const idx = genres.findIndex((g) => g.toLowerCase() === value.trim().toLowerCase())
    if (idx < 0 || selected.includes(idx) || full) return false
    onChange([...selected, idx])
    setText('')
    return true
  }
  return (
    <div className="field" style={{ minWidth: 220 }}>
      <label htmlFor={`${id}-in`}>{label}</label>
      <div className="row" style={{ gap: 6 }}>
        <input
          id={`${id}-in`}
          type="text"
          list={`${id}-list`}
          value={text}
          disabled={full}
          placeholder={full ? `Up to ${max} selected` : selected.length ? 'Add another genre' : 'All genres · type to add'}
          aria-describedby={help ? `${id}-help` : undefined}
          onChange={(e) => {
            const v = e.target.value
            // Picking a datalist option arrives as a replacement (or a plain Event);
            // ordinary typing never auto-adds, so "pop" does not pre-empt "pop-film".
            const inputType = (e.nativeEvent as InputEvent).inputType
            const picked = inputType === undefined || inputType === 'insertReplacementText'
            if (!(picked && add(v))) setText(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const t = text.trim().toLowerCase()
              const match = genres.find((g) => g.toLowerCase() === t) ?? genres.find((g) => g.toLowerCase().startsWith(t))
              if (t && match) add(match)
            }
          }}
          style={{ width: 210 }}
        />
        <datalist id={`${id}-list`}>
          {genres.map((g, i) => (selected.includes(i) ? null : <option key={g} value={g} />))}
        </datalist>
      </div>
      {help && (
        <span id={`${id}-help`} className="small muted">
          {help}
        </span>
      )}
      {selected.length > 0 && (
        <ul className="chips" aria-label={`Selected ${label.toLowerCase()}`} style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
          {selected.map((g) => (
            <li key={g} className="chip">
              {genres[g]}
              <button type="button" aria-label={`Remove ${genres[g]}`} onClick={() => onChange(selected.filter((x) => x !== g))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Inclusive 0-100 popularity range with quick presets. */
export function PopularityRange({ min, max, onChange }: { min: number; max: number; onChange: (min: number, max: number) => void }) {
  const id = useId()
  const set = (lo: number, hi: number) => {
    const a = Math.max(0, Math.min(100, Math.round(lo)))
    const b = Math.max(0, Math.min(100, Math.round(hi)))
    onChange(Math.min(a, b), Math.max(a, b))
  }
  return (
    <fieldset className="field">
      <legend>Popularity score (0–100)</legend>
      <div className="row" style={{ gap: 6 }}>
        <label htmlFor={`${id}-min`} className="visually-hidden">
          Minimum popularity
        </label>
        <input id={`${id}-min`} type="number" min={0} max={100} step={1} value={min} onChange={(e) => e.target.value !== '' && set(Number(e.target.value), max)} />
        <span aria-hidden="true">to</span>
        <label htmlFor={`${id}-max`} className="visually-hidden">
          Maximum popularity
        </label>
        <input id={`${id}-max`} type="number" min={0} max={100} step={1} value={max} onChange={(e) => e.target.value !== '' && set(min, Number(e.target.value))} />
        <div className="segmented" role="group" aria-label="Popularity presets">
          <button type="button" aria-pressed={min === 0 && max === 100} onClick={() => set(0, 100)}>
            All
          </button>
          <button type="button" aria-pressed={min === 1 && max === 100} onClick={() => set(1, 100)}>
            Exclude 0
          </button>
          <button type="button" aria-pressed={min === 0 && max === 0} onClick={() => set(0, 0)}>
            Only 0
          </button>
        </div>
      </div>
    </fieldset>
  )
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Select<T extends string>({ label, value, options, onChange, hideLabel }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; hideLabel?: boolean }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : undefined}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function Pager({ page, pageSize, total, onPage, noun }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; noun: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total ? page * pageSize + 1 : 0
  const to = Math.min(total, (page + 1) * pageSize)
  return (
    <nav className="pager" aria-label={`${noun} pages`}>
      <span className="small muted" aria-live="polite">
        {from.toLocaleString('en-US')}–{to.toLocaleString('en-US')} of {total.toLocaleString('en-US')} {noun}
      </span>
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 0}>
        Previous
      </button>
      <span className="small">
        Page {page + 1} of {pages.toLocaleString('en-US')}
      </span>
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages - 1}>
        Next
      </button>
    </nav>
  )
}
