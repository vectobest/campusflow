import { Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { collector, isCollecting, useCollector } from '../hooks/useCollector'
import { PHASE } from '../lib/collector/controller'

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

/** Fixed atmospheric layer: amber orbs, faint grid, film noise. Purely decorative. */
function Atmosphere() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-48 left-1/2 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-brand opacity-[0.07] blur-[120px] md:h-[640px] md:w-[640px]" />
      <div className="absolute -right-40 bottom-[-10rem] h-[320px] w-[320px] rounded-full bg-brand opacity-[0.04] blur-[140px] md:h-[520px] md:w-[520px]" />
      <div className="grid-bg absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />
      <div className="absolute inset-0 opacity-[0.025] mix-blend-overlay" style={{ backgroundImage: NOISE }} />
    </div>
  )
}

function RecordingBanner() {
  const s = useCollector()
  if (!isCollecting(s)) return null
  const label = { [PHASE.RECORDING]: 'Recording your location', [PHASE.PAUSED]: 'Collection paused', [PHASE.FINISHING]: 'Finishing upload' }[s.phase]
  const live = s.phase === PHASE.RECORDING
  return (
    <Link
      to="/contribute"
      className={`flex items-center justify-center gap-2.5 border-b px-4 py-2 text-sm font-medium backdrop-blur transition-colors ${
        live ? 'border-rec/30 bg-rec/15 text-rec hover:bg-rec/20' : 'border-warn/20 bg-warn-soft text-warn'
      }`}
    >
      <span className={`size-2 shrink-0 rounded-full ${live ? 'rec-dot bg-rec' : 'bg-warn'}`} aria-hidden />
      <span>
        {label}
        <span className="font-normal text-muted"> · {s.queue.length} waiting to upload · manage</span>
      </span>
    </Link>
  )
}

const navClass = ({ isActive }) =>
  `relative rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 focus-visible:text-brand focus-visible:outline-none ${
    isActive ? 'text-ink after:absolute after:inset-x-3 after:-bottom-[13px] after:h-px after:bg-brand after:shadow-[0_0_8px_rgba(245,158,11,0.8)]' : 'text-muted hover:text-ink'
  }`

const mobileNavClass = ({ isActive }) =>
  `flex h-12 items-center rounded-lg px-4 text-base font-medium ${isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-white/5 hover:text-ink'}`

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const s = useCollector()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    document.title = s.phase === PHASE.RECORDING ? '● Recording — CampusFlow' : 'CampusFlow'
  }, [s.phase])

  // Close the mobile menu on navigation.
  useEffect(() => setOpen(false), [location.pathname])

  const onLogout = () => {
    const pending = collector.pendingOnDevice()
    if (pending && (pending.queue?.length || isCollecting(s))) {
      const ok = window.confirm(
        `This device still holds ${pending.queue?.length ?? 0} unsent location points. Signing out deletes them from this device and stops collection. Continue?`,
      )
      if (!ok) return
    }
    collector.clearDevice()
    logout()
    navigate('/')
  }

  const isResearcher = user && (user.role === 'researcher' || user.role === 'admin')
  const links = [
    ['/contribute', 'Contribute', true],
    ['/my-data', 'My data', !!user],
    ['/analytics', 'Analytics', isResearcher],
    ['/research', 'Datasets', isResearcher],
    ['/privacy', 'Privacy', true],
  ].filter(([, , show]) => show)

  return (
    <div className="relative flex min-h-dvh flex-col">
      <Atmosphere />
      <div className="sticky top-0 z-[1000]">
        <RecordingBanner />
        <header className="border-b border-line bg-paper/70 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-6 md:px-8">
            <Link to="/" className="flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight text-ink focus-visible:text-brand focus-visible:outline-none">
              <img src="/favicon.svg" alt="" className="size-7" />
              CampusFlow
            </Link>
            <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
              {links.map(([to, label]) => (
                <NavLink key={to} to={to} className={navClass}>{label}</NavLink>
              ))}
            </nav>
            <div className="ml-auto hidden items-center gap-3 text-sm md:flex">
              {user ? (
                <>
                  <span className="max-w-48 truncate font-mono text-xs text-faint">{user.email}</span>
                  <button onClick={onLogout} className="rounded-md px-3 py-2 font-medium text-muted transition-colors hover:text-ink focus-visible:text-brand focus-visible:outline-none">
                    Sign out
                  </button>
                </>
              ) : (
                <Link to="/login" className="rounded-lg border border-line-strong px-4 py-2 font-medium text-ink transition-all hover:border-white/25 hover:bg-white/5">
                  Sign in
                </Link>
              )}
            </div>
            <button
              className="ml-auto grid size-11 place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-ink md:hidden"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? 'Close menu' : 'Open menu'}
            >
              {open ? <X size={20} strokeWidth={1.5} /> : <Menu size={20} strokeWidth={1.5} />}
            </button>
          </div>
          {open && (
            <nav id="mobile-nav" className="animate-fade-up border-t border-line px-4 pb-4 pt-2 md:hidden" aria-label="Main">
              {links.map(([to, label]) => (
                <NavLink key={to} to={to} className={mobileNavClass}>{label}</NavLink>
              ))}
              <div className="mt-2 border-t border-line pt-2">
                {user ? (
                  <button onClick={onLogout} className="flex h-12 w-full items-center rounded-lg px-4 text-base font-medium text-muted hover:bg-white/5">
                    Sign out <span className="ml-2 truncate font-mono text-xs text-faint">{user.email}</span>
                  </button>
                ) : (
                  <NavLink to="/login" className={mobileNavClass}>Sign in</NavLink>
                )}
              </div>
            </nav>
          )}
        </header>
      </div>

      <main key={location.pathname} className="mx-auto w-full max-w-6xl flex-1 animate-fade-up px-6 py-12 md:px-8 md:py-16">
        <Outlet />
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-8 text-xs text-faint md:flex-row md:items-center md:justify-between md:px-8">
          <span className="font-mono tracking-wide">CAMPUSFLOW · NIT RAIPUR</span>
          <span>A voluntary study of aggregate campus mobility. Never used to monitor individuals.</span>
        </div>
      </footer>
    </div>
  )
}
