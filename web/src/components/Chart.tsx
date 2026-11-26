import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface TableSpec {
  columns: { key: string; label: string; numeric?: boolean; format?: (v: unknown) => string }[]
  rows: Record<string, unknown>[]
}

interface ChartProps {
  /** Builds the SVG for a given width. Must be pure. */
  render: (width: number) => SVGSVGElement | HTMLElement
  /** Short accessible description of what the chart shows. */
  label: string
  caption?: ReactNode
  legend?: { label: string; color: string; shape?: 'square' | 'dot' | 'line' }[]
  table?: TableSpec
  deps: unknown[]
  minWidth?: number
}

/** Observable Plot wrapper: responsive width, labelled figure, legend and a
 *  data-table fallback so no information is carried by colour or hover alone. */
export function Chart({ render, label, caption, legend, table, deps, minWidth = 280 }: ChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(minWidth, Math.floor(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [minWidth])

  useEffect(() => {
    const el = ref.current
    if (!el || !width) return
    const node = render(width)
    const svg = node instanceof SVGSVGElement ? node : node.querySelector('svg')
    svg?.setAttribute('role', 'img')
    svg?.setAttribute('aria-label', label)
    el.replaceChildren(node)
    return () => node.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, label, ...deps])

  return (
    <figure className="chart">
      {legend && legend.length > 0 && (
        <div className="chart-legend" aria-hidden="true">
          {legend.map((l) => (
            <span key={l.label}>
              <i
                className="swatch"
                style={{
                  background: l.color,
                  borderRadius: l.shape === 'dot' ? '50%' : l.shape === 'line' ? 0 : undefined,
                  height: l.shape === 'line' ? 2 : undefined,
                  width: l.shape === 'line' ? 14 : undefined,
                }}
              />
              {l.label}
            </span>
          ))}
        </div>
      )}
      <div ref={ref} className="chart-body" />
      {caption && <figcaption>{caption}</figcaption>}
      {table && <DataTable table={table} title={label} />}
    </figure>
  )
}

function DataTable({ table, title }: { table: TableSpec; title: string }) {
  return (
    <details className="table-view">
      <summary>Show data table</summary>
      <div className="table-scroll">
        <table className="data">
          <caption className="visually-hidden">{title}</caption>
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th key={c.key} scope="col" className={c.numeric ? 'num' : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                {table.columns.map((c) => (
                  <td key={c.key} className={c.numeric ? 'num' : undefined}>
                    {c.format ? c.format(r[c.key]) : String(r[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
