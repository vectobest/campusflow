import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  CloudUpload,
  LocateFixed,
  MapPinOff,
  Pause,
  Play,
  Smartphone,
  Square,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { collector, useBackgroundGaps, useCollector, useWakeLock } from '../hooks/useCollector'
import { PHASE } from '../lib/collector/controller'
import { Alert, Button, Card, Pill, Spinner, Stat, buttonClass, formatDuration } from './ui'

const REASON_LABELS = {
  invalid_latitude: 'invalid latitude',
  invalid_longitude: 'invalid longitude',
  invalid_timestamp: 'invalid timestamp',
  timestamp_in_future: 'timestamp in the future',
  timestamp_before_session: 'before session start',
  timestamp_after_session: 'after session end',
  invalid_accuracy: 'invalid accuracy',
  invalid_speed: 'invalid speed',
  invalid_heading: 'invalid heading',
  outside_study_area: 'outside the study area',
  duplicate_in_batch: 'conflicting duplicate',
  sequence_conflict: 'conflicting duplicate',
  invalid_schema: 'malformed',
}

function accuracyTone(acc) {
  if (acc == null) return ['neutral', 'unknown']
  if (acc <= 15) return ['ok', 'good']
  if (acc <= 40) return ['warn', 'fair']
  return ['rec', 'poor']
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function usePermissionState() {
  const [state, setState] = useState('unknown')
  useEffect(() => {
    let status
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((s) => {
        status = s
        setState(s.state)
        s.onchange = () => setState(s.state)
      })
      .catch(() => {})
    return () => {
      if (status) status.onchange = null
    }
  }, [])
  return state
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

const formFactor = () => (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop')

function requestFix() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Object.assign(new Error('This browser does not support location access.'), { code: 2 }))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })
  })
}

function StartPanel({ config, onStarted }) {
  const { participant } = useAuth()
  const options = [5, 10, 15, 30].filter((v) => v >= config.minSamplingIntervalSeconds && v <= config.maxSamplingIntervalSeconds)
  const [interval, setIntervalS] = useState(config.defaultSamplingIntervalSeconds)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [openSession, setOpenSession] = useState(null)
  const secure = window.isSecureContext

  useEffect(() => {
    // An open session that this tab does not know about (other device, cleared storage).
    api
      .mySessions(1, 1)
      .then(({ data }) => {
        const s = data[0]
        if (s && ['ACTIVE', 'PAUSED'].includes(s.collectionStatus)) setOpenSession(s)
      })
      .catch(() => {})
  }, [])

  const closeOpen = async () => {
    setBusy(true)
    try {
      await api.setSessionStatus(openSession.sessionId, 'COMPLETED')
      setOpenSession(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      // Ask for permission before creating the session, so a refusal leaves no empty session behind.
      await requestFix()
      const { data } = await api.createSession({ samplingIntervalSeconds: interval, formFactor: formFactor() })
      collector.begin({ participantId: participant.participantId, sessionId: data.sessionId, samplingIntervalSeconds: data.samplingIntervalSeconds })
      onStarted?.()
    } catch (e) {
      if (e.code === 1) setError('Location permission was denied. Allow location for this site in your browser settings, then try again.')
      else if (e.code === 2 || e.code === 3) setError('Your device could not determine its location. Move outdoors or enable location services, then try again.')
      else if (e.code === 'session_already_open') setOpenSession(e.details?.session ?? null)
      else setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="relative overflow-hidden">
      <div aria-hidden className="absolute -right-24 -top-24 size-64 rounded-full bg-brand opacity-[0.07] blur-[80px]" />
      <h2 className="text-2xl font-semibold">Start a collection session</h2>
      <p className="mt-2 text-muted">Recording begins only when you press Start, and stops when you press Stop or leave the page.</p>

      {!secure && (
        <div className="mt-5">
          <Alert tone="rec" icon={MapPinOff} title="Location requires a secure connection">
            Open CampusFlow over https:// (or on localhost) to enable location access.
          </Alert>
        </div>
      )}

      {openSession && (
        <div className="mt-5 space-y-3">
          <Alert tone="warn" icon={AlertTriangle} title="You already have an open session">
            Started {new Date(openSession.startedAt).toLocaleString()}, possibly on another device or tab. Stop it before starting a new one.
          </Alert>
          <Button variant="secondary" onClick={closeOpen} loading={busy}>Stop the open session</Button>
        </div>
      )}

      <fieldset className="mt-8">
        <legend className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Sampling interval</legend>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {options.map((v) => (
            <label
              key={v}
              className="cursor-pointer rounded-lg border border-line bg-white/[0.02] py-3 text-center font-display text-base font-medium text-muted transition-all duration-200 hover:border-line-strong hover:text-ink has-[:checked]:border-brand/40 has-[:checked]:bg-brand-soft has-[:checked]:text-brand has-[:checked]:shadow-[var(--shadow-glow-sm)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent"
            >
              <input type="radio" name="interval" className="sr-only" value={v} checked={interval === v} onChange={() => setIntervalS(v)} />
              {v}s
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-faint">
          Shorter intervals capture routes in more detail but use more battery. Study default: {config.defaultSamplingIntervalSeconds} s. The choice is saved with your session.
        </p>
      </fieldset>

      <ul className="mt-8 grid gap-3 text-sm text-muted sm:grid-cols-3">
        {[
          [Smartphone, 'Keep this page open', 'Browsers usually pause location when the screen locks.'],
          [LocateFixed, 'Outdoors is best', 'Indoor fixes can be off by tens of metres.'],
          [CloudOff, 'Offline is fine', 'Points wait on this device and upload later.'],
        ].map(([Icon, title, body]) => (
          <li key={title} className="rounded-lg border border-line bg-white/[0.02] p-4">
            <Icon size={18} strokeWidth={1.5} className="text-brand" aria-hidden />
            <div className="mt-3 font-medium text-ink">{title}</div>
            <div className="mt-1 text-xs leading-relaxed text-faint">{body}</div>
          </li>
        ))}
      </ul>

      {error && <div className="mt-5"><Alert tone="rec" icon={MapPinOff} title="Could not start">{error}</Alert></div>}

      <Button size="lg" className="mt-8 w-full sm:w-auto" onClick={start} loading={busy} disabled={!secure || !!openSession}>
        <Play size={18} strokeWidth={1.75} aria-hidden /> Start collection
      </Button>
    </Card>
  )
}

/** Pulsing record indicator with expanding rings while live. */
function RecordOrb({ recording }) {
  return (
    <div className="relative grid size-16 shrink-0 place-items-center">
      {recording && (
        <>
          <span className="ring-expand absolute inset-0 rounded-full border border-rec/50" aria-hidden />
          <span className="ring-expand absolute inset-0 rounded-full border border-rec/40 [animation-delay:1.2s]" aria-hidden />
        </>
      )}
      <span className={`grid size-12 place-items-center rounded-full ${recording ? 'bg-rec-soft' : 'bg-warn-soft'}`}>
        <span className={`size-4 rounded-full ${recording ? 'rec-dot bg-rec' : 'bg-warn'}`} aria-hidden />
      </span>
    </div>
  )
}

/**
 * Live preview of the participant's own recent path, drawn from fixes held in
 * memory on this device only. Scaled to fit; north is up.
 */
function LivePath({ points, recording }) {
  const W = 320
  const H = 180
  const pad = 16
  if (points.length < 2) {
    return (
      <div className="grid h-[180px] place-items-center rounded-lg border border-dashed border-line text-xs text-faint">
        {recording ? 'Your path will appear here as you move…' : 'No path yet'}
      </div>
    )
  }
  const lat0 = points[0].lat
  const kx = Math.cos((lat0 * Math.PI) / 180)
  const xs = points.map((p) => p.lon * kx)
  const ys = points.map((p) => p.lat)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  // Keep at least ~40 m of span so standing still does not zoom into GPS jitter.
  const minSpan = 40 / 111320
  const span = Math.max(maxX - minX, maxY - minY, minSpan)
  const scale = Math.min((W - 2 * pad) / span, (H - 2 * pad) / span)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const proj = (i) => [W / 2 + (xs[i] - cx) * scale, H / 2 - (ys[i] - cy) * scale]
  const d = points.map((_, i) => proj(i)).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const [hx, hy] = proj(points.length - 1)
  const [sx, sy] = proj(0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[180px] w-full rounded-lg border border-line bg-paper/60" role="img" aria-label="Preview of your recent path">
      <defs>
        <linearGradient id="trail" x1="0" x2="1">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="1" />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke="url(#trail)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 6px rgba(245,158,11,0.5))' }} />
      <circle cx={sx} cy={sy} r="3.5" fill="#12121a" stroke="#a1a1aa" strokeWidth="1.5" />
      <circle cx={hx} cy={hy} r="9" fill="#f59e0b" opacity="0.18">
        {recording && <animate attributeName="r" values="6;14;6" dur="2s" repeatCount="indefinite" />}
      </circle>
      <circle cx={hx} cy={hy} r="4.5" fill="#f59e0b" />
    </svg>
  )
}

const formatClock = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(t / 3600)
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0')
  const sec = String(t % 60).padStart(2, '0')
  return h ? `${h}:${m}:${sec}` : `${m}:${sec}`
}

const formatDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`)

function ActivePanel() {
  const s = useCollector()
  const now = useNow()
  const permission = usePermissionState()
  const online = useOnline()
  const [gapNotice, setGapNotice] = useState(null)
  const recording = s.phase === PHASE.RECORDING

  useWakeLock(recording)
  const onReturn = useCallback((ms) => {
    if (ms > 15000) setGapNotice(`The page was in the background for ${formatDuration(ms)}. Location points may be missing for that time.`)
  }, [])
  useBackgroundGaps(recording, onReturn)

  const lastFix = s.gps.lastFix
  const [tone, quality] = accuracyTone(lastFix?.accuracy)
  const fixAge = lastFix ? now - lastFix.timestamp : null
  const stale = recording && (fixAge == null || fixAge > Math.max(30000, s.samplingIntervalSeconds * 3000))
  const retryIn = s.upload.nextRetryAt ? Math.max(0, Math.ceil((s.upload.nextRetryAt - now) / 1000)) : null

  return (
    <div className="space-y-4">
      <Card className={`relative overflow-hidden ${recording ? 'border-rec/25' : ''}`}>
        {recording && <div aria-hidden className="absolute -left-20 -top-20 size-56 rounded-full bg-rec opacity-[0.08] blur-[70px]" />}
        <div className="flex items-center gap-4">
          <RecordOrb recording={recording} />
          <div className="min-w-0 flex-1">
            <div className="text-xl font-semibold" aria-live="polite">
              {recording ? 'Recording location' : s.phase === PHASE.PAUSED ? 'Paused · not recording' : 'Finishing upload…'}
            </div>
            <div className="truncate font-mono text-xs text-faint">{s.sessionId}</div>
          </div>
          {s.startedAtMs && (
            <div className="text-right">
              <div className="tabular font-display text-2xl font-semibold text-ink sm:text-3xl">{formatClock(now - s.startedAtMs)}</div>
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">elapsed</div>
            </div>
          )}
        </div>

        <div className="mt-7 grid gap-6 md:grid-cols-[1.1fr_1fr] md:items-center">
          <LivePath points={s.recent} recording={recording} />
          <div className="grid grid-cols-2 gap-x-4 gap-y-6">
            <Stat label="Walked" value={formatDistance(s.stats.distanceM ?? 0)} hint="good fixes only" accent />
            <Stat label="Recorded" value={s.stats.recorded} hint={`every ${s.samplingIntervalSeconds} s`} />
            <Stat label="Uploaded" value={s.serverTotals?.acceptedObservationCount ?? s.stats.accepted} hint={`${s.queue.length} waiting on device`} />
            <Stat label="Rejected" value={s.serverTotals?.rejectedObservationCount ?? s.stats.rejected} hint="failed validation" />
          </div>
        </div>

        <div className="mt-7 flex flex-wrap gap-2">
          <Pill tone={permission === 'granted' ? 'ok' : permission === 'denied' ? 'rec' : 'neutral'}>
            <LocateFixed size={13} strokeWidth={1.75} aria-hidden /> Permission: {permission}
          </Pill>
          <Pill tone={tone}>
            Accuracy: {lastFix?.accuracy != null ? `±${Math.round(lastFix.accuracy)} m (${quality})` : 'no fix yet'}
          </Pill>
          {lastFix && <Pill tone={stale ? 'warn' : 'neutral'}>Last fix {formatDuration(fixAge)} ago</Pill>}
          <Pill tone={online ? 'neutral' : 'warn'}>
            {online ? <CloudUpload size={13} strokeWidth={1.75} aria-hidden /> : <CloudOff size={13} strokeWidth={1.75} aria-hidden />}
            {!online ? 'Offline, will retry' : s.upload.inFlight ? 'Uploading…' : retryIn != null ? `Retry in ${retryIn} s` : 'Upload OK'}
          </Pill>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3">
          {recording && (
            <Button variant="secondary" size="lg" onClick={() => collector.pause()}>
              <Pause size={18} strokeWidth={1.75} aria-hidden /> Pause
            </Button>
          )}
          {s.phase === PHASE.PAUSED && (
            <Button size="lg" onClick={() => collector.resume()} disabled={!!s.fatal}>
              <Play size={18} strokeWidth={1.75} aria-hidden /> Resume
            </Button>
          )}
          {s.phase !== PHASE.FINISHING && (
            <Button variant="danger" size="lg" onClick={() => collector.stop()}>
              <Square size={16} strokeWidth={1.75} aria-hidden /> Stop
            </Button>
          )}
        </div>
      </Card>

      {s.fatal?.code === 'unauthenticated' && (
        <Alert tone="rec" title="Sign in to finish uploading">
          {s.fatal.message} <Link className="font-medium underline" to="/login?next=/contribute">Sign in</Link>
        </Alert>
      )}
      {s.fatal && s.fatal.code !== 'unauthenticated' && <Alert tone="rec" title="Collection stopped">{s.fatal.message}</Alert>}
      {s.interrupted && s.phase === PHASE.PAUSED && (
        <Alert tone="warn" icon={AlertTriangle} title="Your session was interrupted">
          The page was closed or reloaded while recording, so collection was paused. Press Resume to continue, or Stop to finish.
        </Alert>
      )}
      {s.gps.error === 'permission_denied' && (
        <Alert tone="rec" icon={MapPinOff} title="Location permission was turned off">
          Recording is paused. Re-enable location for this site in your browser settings, then press Resume.
        </Alert>
      )}
      {(s.gps.error === 'unavailable' || s.gps.error === 'timeout') && recording && (
        <Alert tone="warn" icon={AlertTriangle} title="Weak or no location signal">Still trying. Fixes are recorded as soon as the device reports them.</Alert>
      )}
      {stale && !s.gps.error && <Alert tone="warn" icon={AlertTriangle} title="No recent location fix">Your device has not reported a position recently. Keep the page open and in front.</Alert>}
      {gapNotice && <Alert tone="info" title="Possible gap in your trace">{gapNotice}</Alert>}
      {s.storageError && <Alert tone="warn" title="Could not save to this device">Unsent points are kept in memory only. Keep this page open until they upload.</Alert>}
      {s.phase === PHASE.FINISHING && s.queue.length > 0 && (
        <Alert tone="info" title={`${s.queue.length} points still uploading`}>
          Keep this page open. If you are offline, uploading resumes automatically when you reconnect or reopen this page.
        </Alert>
      )}
    </div>
  )
}

function DonePanel() {
  const s = useCollector()
  const totals = s.serverTotals
  const reasons = Object.entries(s.stats.rejectedReasons)
  return (
    <Card highlighted className="relative overflow-hidden">
      <div className="glow-line absolute inset-x-10 top-0 h-px" aria-hidden />
      <div className="flex items-center gap-4">
        <span className="grid size-12 place-items-center rounded-full bg-ok-soft text-ok">
          <CheckCircle2 size={24} strokeWidth={1.5} aria-hidden />
        </span>
        <div>
          <h2 className="text-2xl font-semibold">Session finished. Thank you.</h2>
          <p className="mt-1 text-muted">{s.notice ?? 'Your data was received. You can review or delete it at any time.'}</p>
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat label="Walked" value={formatDistance(s.stats.distanceM ?? 0)} accent />
        <Stat label="Recorded" value={s.stats.recorded} />
        <Stat label="Accepted" value={totals?.acceptedObservationCount ?? s.stats.accepted} />
        <Stat label="Not uploaded" value={s.stats.discarded} hint={`${totals?.rejectedObservationCount ?? s.stats.rejected} rejected`} />
      </div>
      {reasons.length > 0 && (
        <p className="mt-5 text-sm text-faint">
          Rejected because: {reasons.map(([r, n]) => `${REASON_LABELS[r] ?? r} (${n})`).join(', ')}. Rejected points are not stored.
        </p>
      )}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button onClick={() => collector.reset()}>Start another session</Button>
        <Link to="/my-data" className={buttonClass({ variant: 'secondary' })}>Review my data</Link>
      </div>
    </Card>
  )
}

export default function CollectorPanel() {
  const { participant } = useAuth()
  const s = useCollector()
  const [config, setConfig] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (s.phase === PHASE.IDLE && participant) collector.restore(participant.participantId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant?.participantId])

  useEffect(() => {
    api.collectionConfig().then((r) => setConfig(r.data)).catch((e) => setError(e.message))
  }, [])

  if (s.phase === PHASE.DONE) return <DonePanel />
  if (s.phase !== PHASE.IDLE) return <ActivePanel />
  if (error) return <Alert tone="rec" title="Could not reach the CampusFlow server">{error}</Alert>
  if (!config) return <Spinner />
  return <StartPanel config={config} />
}
