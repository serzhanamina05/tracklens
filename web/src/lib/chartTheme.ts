import { useEffect, useState } from 'react'

/** Resolve a CSS custom property to a concrete colour for SVG attributes. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function useColorScheme(): 'light' | 'dark' {
  const q = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setDark(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return dark ? 'dark' : 'light'
}

/** Shared Plot styling so every chart uses the same recessive axes and type. */
export function plotBase(width: number) {
  return {
    width,
    style: {
      fontFamily: 'var(--font)',
      fontSize: '12px',
      color: cssVar('--text-secondary'),
      background: 'transparent',
      overflow: 'visible',
    },
  }
}
