import { ArrowRight, ChevronDown, Clock, Footprints, GitBranch, Lock, MapPinned, Route, ShieldCheck, Smartphone, Waypoints } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import HeroGraphic from '../components/HeroGraphic'
import { Card, CountUp, Eyebrow, buttonClass } from '../components/ui'

const METHODS = [
  { icon: Footprints, title: 'Stay points', tag: 'RQ · where', body: 'Detects where people pause for 5+ minutes, then groups those stops into places like the canteen or library.' },
  { icon: Clock, title: 'Crowded zones by hour', tag: 'RQ · when', body: 'Counts distinct students per 50 m zone per hour, so a phone sitting still never counts as a crowd.' },
  { icon: Route, title: 'Frequent paths', tag: 'RQ · how', body: 'Traces every walk between stops onto a campus grid and finds the corridors used most.' },
  { icon: Waypoints, title: 'PrefixSpan sequences', tag: 'RQ · order', body: 'Mines the order places are visited in, e.g. hostel → academic block → canteen.' },
  { icon: GitBranch, title: 'Trajectory clusters', tag: 'RQ · similar', body: 'Groups walks with similar shape and direction to reveal the campus’s main routes.' },
]

const STEPS = [
  { icon: ShieldCheck, title: 'Consent', body: 'Read what is collected and agree, statement by statement.' },
  { icon: Smartphone, title: 'Walk', body: 'Press Start and move around campus as usual. Pause or stop any time.' },
  { icon: MapPinned, title: 'Discover', body: 'Traces become aggregate patterns. Nobody’s individual path is ever shown.' },
]

const FAQ = [
  ['Do I need to install anything?', 'No. CampusFlow runs in your phone’s browser. Open the link, sign in, and press Start.'],
  ['Does it track me in the background?', 'No. Recording happens only while a session is running and the page is open. Browsers stop location updates when the screen locks, and the app tells you when that happens.'],
  ['Who can see where I went?', 'Only you can see your own trace, on the “My data” page. Everything shown to researchers is aggregated, and any group smaller than the privacy threshold is hidden.'],
  ['Can I delete my data?', 'Yes. Delete a single session, everything, or your whole account at any time. Withdrawing consent stops collection immediately.'],
  ['How much battery does it use?', 'GPS uses extra battery, and keeping the screen on adds to it. Start with a reasonable charge; choosing a 10–30 second interval saves power.'],
]

function LiveStats() {
  const [s, setS] = useState(null)
  useEffect(() => {
    api.publicStats().then((r) => setS(r.data)).catch(() => {})
  }, [])
  if (!s) return null
  const items = [
    ['Sessions contributed', s.sessions],
    ['Hours recorded', s.hoursRecorded],
    ['GPS points', s.observations],
    ['Contributors', s.participants ?? `< ${s.minAggregateParticipants}`],
  ]
  return (
    <div className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="bg-surface/90 px-5 py-5 backdrop-blur">
          <div className="tabular font-display text-2xl font-semibold text-ink sm:text-3xl"><CountUp value={value} /></div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">{label}</div>
        </div>
      ))}
      {s.sessions === 0 && (
        <div className="col-span-full bg-surface/90 px-5 py-3 text-sm text-muted">No sessions yet. Be the first to contribute a trace.</div>
      )}
    </div>
  )
}

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-line">
      <button className="flex w-full items-center justify-between gap-4 py-5 text-left font-medium text-ink transition-colors hover:text-brand focus-visible:text-brand focus-visible:outline-none" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {q}
        <ChevronDown size={18} strokeWidth={1.5} className={`shrink-0 text-faint transition-transform duration-300 ${open ? 'rotate-180 text-brand' : ''}`} />
      </button>
      <div className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <p className="overflow-hidden pb-5 leading-relaxed text-muted">{a}</p>
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <div className="-mt-4 space-y-28 md:space-y-36">
      <section className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand-soft px-3.5 py-1.5 shadow-[var(--shadow-glow-sm)]">
            <span className="live-dot size-1.5 rounded-full bg-brand" aria-hidden />
            <span className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-brand">Live study · NIT Raipur</span>
          </div>
          <h1 className="mt-7 text-4xl font-semibold leading-[1.05] sm:text-5xl md:text-6xl">
            <span className="text-gradient">See how the campus</span>
            <br />
            <span className="text-brand [text-shadow:0_0_40px_rgba(245,158,11,0.35)]">moves.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            Students voluntarily share GPS traces of their walks around campus. CampusFlow turns them into the paths, places and busy hours that
            shape everyday campus life, without ever exposing an individual.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link to="/contribute" className={buttonClass({ size: 'lg' })}>
              Contribute a trace <ArrowRight size={18} strokeWidth={1.75} />
            </Link>
            <Link to="/privacy" className={buttonClass({ variant: 'secondary', size: 'lg' })}>
              <Lock size={16} strokeWidth={1.75} /> How your data is handled
            </Link>
          </div>
        </div>
        <HeroGraphic />
      </section>

      <LiveStats />

      <section>
        <Eyebrow>How it works</Eyebrow>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold sm:text-4xl">Three steps. One walk at a time.</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <div key={title} className="relative">
              <div className="flex items-center gap-4">
                <span className="grid size-11 place-items-center rounded-lg border border-line-strong bg-elevated text-brand">
                  <Icon size={20} strokeWidth={1.5} />
                </span>
                <span className="font-mono text-xs text-faint">0{i + 1}</span>
                {i < STEPS.length - 1 && <span className="hidden h-px flex-1 bg-gradient-to-r from-line-strong to-transparent md:block" />}
              </div>
              <h3 className="mt-5 text-xl font-semibold">{title}</h3>
              <p className="mt-2 leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <Eyebrow>Methods</Eyebrow>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold sm:text-4xl">Five lenses on campus mobility.</h2>
        <p className="mt-4 max-w-2xl text-muted">Each result is computed from real traces, with documented parameters, sensitivity checks and privacy suppression.</p>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {METHODS.map(({ icon: Icon, title, tag, body }, i) => (
            <Card key={title} interactive highlighted={i === 0} className="group">
              <div className="flex items-center justify-between">
                <Icon size={22} strokeWidth={1.5} className="text-faint transition-colors duration-300 group-hover:text-brand" />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{tag}</span>
              </div>
              <h3 className="mt-6 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </Card>
          ))}
          <Card className="flex flex-col justify-between border-dashed bg-transparent">
            <p className="text-sm leading-relaxed text-muted">
              Every count is of <span className="text-ink">distinct people</span>, never raw GPS points. Results based on too few participants are hidden.
            </p>
            <Link to="/contribute" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline">
              Add your walk <ArrowRight size={16} strokeWidth={1.75} />
            </Link>
          </Card>
        </div>
      </section>

      <section className="relative overflow-hidden rounded-2xl border border-line bg-surface/80 px-6 py-14 backdrop-blur sm:px-12">
        <div className="glow-line absolute inset-x-12 top-0 h-px" aria-hidden />
        <div className="grid gap-10 md:grid-cols-[auto_1fr] md:items-center">
          <span className="grid size-14 place-items-center rounded-xl bg-brand-soft text-brand shadow-[var(--shadow-glow-sm)]">
            <ShieldCheck size={26} strokeWidth={1.5} />
          </span>
          <div>
            <h2 className="text-2xl font-semibold sm:text-3xl">Consent first, by design.</h2>
            <p className="mt-3 max-w-3xl leading-relaxed text-muted">
              You start and stop every session. Your email is stored apart from your location data. Only you can see your own trace, and you can
              delete it at any time. Published results are aggregates of several people. This is research about the campus, not surveillance of
              anyone.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <Eyebrow>FAQ</Eyebrow>
          <h2 className="mt-3 text-3xl font-semibold sm:text-4xl">Questions, answered.</h2>
        </div>
        <div className="border-t border-line">
          {FAQ.map(([q, a]) => <FaqItem key={q} q={q} a={a} />)}
        </div>
      </section>

      <section className="relative pb-8 text-center">
        <div aria-hidden className="absolute left-1/2 top-1/2 -z-10 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand opacity-[0.08] blur-[100px]" />
        <h2 className="text-3xl font-semibold sm:text-5xl">Your next walk could map the campus.</h2>
        <p className="mx-auto mt-4 max-w-xl text-muted">Takes ten seconds to start. Stop whenever you like.</p>
        <Link to="/contribute" className={buttonClass({ size: 'lg', className: 'mt-8' })}>
          Start contributing <ArrowRight size={18} strokeWidth={1.75} />
        </Link>
      </section>
    </div>
  )
}
