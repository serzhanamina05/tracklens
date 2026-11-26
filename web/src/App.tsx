import { lazy, Suspense, useEffect } from 'react'
import { NavLink, Route, Routes, useLocation, Link } from 'react-router-dom'
import { FULL_MODE } from './lib/data'
import { Loading } from './components/ui'
const Overview = lazy(() => import('./views/Overview'))

const Music = lazy(() => import('./views/Music'))
const Compare = lazy(() => import('./views/Compare'))
const Explorer = lazy(() => import('./views/Explorer'))
const Similar = lazy(() => import('./views/Similar'))
const ModelLab = lazy(() => import('./views/ModelLab'))
const DataNotes = lazy(() => import('./views/DataNotes'))

const NAV = [
  { to: '/', label: 'Music Discovery', end: true },
  { to: '/overview', label: 'Genre Dashboard' },
  { to: '/explorer', label: FULL_MODE ? 'Track Explorer' : 'Genre Explorer' },
  { to: '/similar', label: FULL_MODE ? 'Find Similar Tracks' : 'Similar Genres' },
  { to: '/compare', label: 'Compare Genres' },
  { to: '/model', label: 'Model Lab' },
  { to: '/method', label: 'Data & Method' },
]

const TITLES: Record<string, string> = {
  '/': 'Music Discovery',
  '/overview': 'Genre Dashboard',
  '/explorer': NAV[2].label,
  '/similar': NAV[3].label,
  '/compare': 'Compare Genres',
  '/model': 'Model Lab',
  '/method': 'Data & Method',
}

export default function App() {
  const { pathname } = useLocation()
  useEffect(() => {
    const key = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
    document.title = `${TITLES[key] ?? 'Not found'} · TrackLens`
    window.scrollTo(0, 0)
    document.getElementById('main')?.focus({ preventScroll: true })
  }, [pathname])

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label="TrackLens home">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
            TrackLens
          </Link>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <span className="mode-pill">
            {FULL_MODE ? (
              'Local full-data mode'
            ) : (
              <>
                Public aggregate edition · <Link to="/method#publication">why</Link>
              </>
            )}
          </span>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Suspense fallback={<Loading what="view" />}>
          <Routes>
            <Route path="/" element={<Music />} />
            <Route path="/overview" element={<Overview />} />
            <Route path="/explorer" element={<Explorer />} />
            <Route path="/similar" element={<Similar />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/model" element={<ModelLab />} />
            <Route path="/method" element={<DataNotes />} />
            <Route
              path="*"
              element={
                <div className="page-head">
                  <h1>Page not found</h1>
                  <p>
                    That address is not part of TrackLens. <Link to="/">Go to Music Discovery</Link>.
                  </p>
                </div>
              }
            />
          </Routes>
        </Suspense>
      </main>
      <footer className="site">
        TrackLens analyses a third-party snapshot of 114,000 track rows. Popularity is a 0–100 score recorded in that file, not a measure of listening. <Link to="/method">Data notes and attribution</Link>.
      </footer>
    </>
  )
}
