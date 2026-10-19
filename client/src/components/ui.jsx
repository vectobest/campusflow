import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function Card({ className = '', interactive = false, highlighted = false, children, ...props }) {
  return (
    <section
      className={`glass rounded-xl p-5 sm:p-7 ${interactive ? 'glass-hover' : ''} ${highlighted ? 'border-brand/25 shadow-[var(--shadow-border-glow)]' : ''} ${className}`}
      {...props}
    >
      {children}
    </section>
  )
}

const variants = {
  primary:
    'bg-brand text-brand-fg hover:brightness-110 hover:shadow-[var(--shadow-glow-btn)] disabled:opacity-40 disabled:hover:shadow-none disabled:hover:brightness-100',
  secondary: 'border border-line-strong bg-transparent text-ink hover:border-white/25 hover:bg-white/5 disabled:text-faint',
  danger: 'border border-rec/40 bg-rec/10 text-rec hover:bg-rec/20 hover:border-rec/60 disabled:opacity-40',
  ghost: 'text-muted hover:bg-white/5 hover:text-ink',
}

export const buttonClass = ({ variant = 'primary', size = 'md', className = '' } = {}) => {
  const sizes = { sm: 'h-9 px-3.5 text-sm', md: 'h-11 px-5 text-sm', lg: 'h-12 px-6 text-base' }
  return `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-all duration-200 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:active:scale-100 ${sizes[size]} ${variants[variant]} ${className}`
}

export function Button({ variant = 'primary', size = 'md', loading = false, className = '', children, ...props }) {
  return (
    <button className={buttonClass({ variant, size, className })} disabled={loading || props.disabled} {...props}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

const tones = {
  neutral: 'bg-white/5 text-muted border-line',
  ok: 'bg-ok-soft text-ok border-ok/20',
  warn: 'bg-warn-soft text-warn border-warn/20',
  rec: 'bg-rec-soft text-rec border-rec/20',
  brand: 'bg-brand-soft text-brand border-brand/20',
}

export function Pill({ tone = 'neutral', children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}>
      {children}
    </span>
  )
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Counts up to a number the first time it scrolls into view. Non-numbers render as-is. */
export function CountUp({ value, duration = 900 }) {
  const ref = useRef(null)
  const numeric = typeof value === 'number' && Number.isFinite(value)
  const [shown, setShown] = useState(numeric && !reducedMotion() ? 0 : value)
  const done = useRef(false)

  useEffect(() => {
    if (!numeric) return undefined
    if (done.current || reducedMotion()) {
      setShown(value)
      return undefined
    }
    let raf
    const run = () => {
      done.current = true
      const start = performance.now()
      const tick = (t) => {
        const p = Math.min(1, (t - start) / duration)
        const eased = 1 - (1 - p) ** 3
        setShown(p < 1 ? Math.round(value * eased * 10) / 10 : value)
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (run(), io.disconnect()), { threshold: 0.3 })
    if (ref.current) io.observe(ref.current)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [value, numeric, duration])

  const display = numeric ? (Number.isInteger(value) ? Math.round(shown) : shown).toLocaleString() : value
  return <span ref={ref}>{display}</span>
}

export function Stat({ label, value, hint, accent = false }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className={`tabular mt-2 truncate font-display text-3xl font-semibold tracking-tight ${accent ? 'text-brand' : 'text-ink'}`}>
        <CountUp value={value} />
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  )
}

export function Alert({ tone = 'warn', icon: Icon, title, children }) {
  const t = {
    warn: 'border-warn/20 bg-warn-soft text-warn',
    rec: 'border-rec/25 bg-rec-soft text-rec',
    ok: 'border-ok/20 bg-ok-soft text-ok',
    info: 'border-brand/20 bg-brand-soft text-brand',
  }
  return (
    <div role={tone === 'rec' ? 'alert' : 'status'} className={`flex gap-3 rounded-lg border p-4 text-sm ${t[tone]}`}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />}
      <div className="min-w-0">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className="mt-0.5 leading-relaxed text-muted">{children}</div>}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div className="mt-2">{children}</div>
      {hint && <span className="mt-1.5 block text-xs text-faint">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'h-11 w-full rounded-lg border border-line bg-card px-3.5 text-base text-ink placeholder:text-faint backdrop-blur outline-none transition-all duration-200 focus:border-accent/50 focus:ring-2 focus:ring-accent/20 focus:shadow-[0_0_20px_rgba(245,158,11,0.1)]'

export function Eyebrow({ children, live = false }) {
  return (
    <div className="inline-flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.14em] text-brand">
      {live && <span className="live-dot size-1.5 rounded-full bg-brand" aria-hidden />}
      {children}
    </div>
  )
}

export function PageHeader({ eyebrow, title, children }) {
  return (
    <header className="mb-10 animate-fade-up">
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h1 className="mt-3 text-3xl font-semibold text-ink sm:text-4xl">{title}</h1>
      {children && <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">{children}</p>}
    </header>
  )
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16 text-brand">
      <Loader2 className="size-6 animate-spin" strokeWidth={1.75} aria-label="Loading" />
    </div>
  )
}

export function formatDuration(ms) {
  if (ms == null || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h} h ${m} min`
  if (m > 0) return `${m} min ${s % 60} s`
  return `${s} s`
}

export const formatDateTime = (d) =>
  d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'
