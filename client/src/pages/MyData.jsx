import { ChevronDown, Map as MapIcon, Trash2 } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Alert, Button, Card, PageHeader, Pill, Spinner, formatDateTime, formatDuration } from '../components/ui'
import { collector, useCollector } from '../hooks/useCollector'

const TraceMap = lazy(() => import('../components/TraceMap'))

const statusTone = { ACTIVE: 'rec', PAUSED: 'warn', COMPLETED: 'ok', ABANDONED: 'neutral' }
const PAGE_SIZE = 10

function SessionRow({ session, onDeleted, activeLocally }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open && !detail) api.session(session.sessionId).then((r) => setDetail(r.data)).catch((e) => setError(e.message))
  }, [open, detail, session.sessionId])

  const remove = async () => {
    if (!window.confirm('Delete this session and all of its location points? This cannot be undone.')) return
    setBusy(true)
    try {
      await api.deleteSession(session.sessionId)
      if (activeLocally) collector.clearDevice()
      onDeleted()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const end = session.endedAt ? new Date(session.endedAt) : null
  return (
    <li className="py-4">
      <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{formatDateTime(session.startedAt)}</span>
            <Pill tone={statusTone[session.collectionStatus]}>{session.collectionStatus.toLowerCase()}</Pill>
          </div>
          <div className="tabular mt-1 text-sm text-muted">
            {session.acceptedObservationCount} points · {end ? formatDuration(end - new Date(session.startedAt)) : 'in progress'} · every {session.samplingIntervalSeconds} s
            {session.rejectedObservationCount > 0 && ` · ${session.rejectedObservationCount} rejected`}
          </div>
        </div>
        <ChevronDown className={`size-5 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {error && <Alert tone="rec" title="Something went wrong">{error}</Alert>}
          {detail && Object.keys(detail.rejectionSummary).length > 0 && (
            <p className="text-sm text-muted">
              Rejected points by reason: {Object.entries(detail.rejectionSummary).map(([r, n]) => `${r.replaceAll('_', ' ')} (${n})`).join(', ')}.
            </p>
          )}
          {detail && detail.duplicateSubmissionCount > 0 && (
            <p className="text-sm text-muted">{detail.duplicateSubmissionCount} re-sent points were recognised as duplicates and stored only once.</p>
          )}
          <Suspense fallback={<Spinner />}>
            <TraceMap sessionId={session.sessionId} />
          </Suspense>
          <div className="flex items-center justify-between gap-3">
            <span className="truncate font-mono text-xs text-muted">{session.sessionId}</span>
            <Button variant="secondary" size="sm" onClick={remove} loading={busy}>
              <Trash2 className="size-4" aria-hidden /> Delete session
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

export default function MyData() {
  const { participant, setParticipant, logout } = useAuth()
  const navigate = useNavigate()
  const local = useCollector()
  const [page, setPage] = useState(1)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState(null)

  const load = useCallback(() => {
    api.mySessions(page, PAGE_SIZE).then(setResult).catch((e) => setError(e.message))
  }, [page])
  useEffect(load, [load])

  const run = async (key, confirmText, fn) => {
    if (!window.confirm(confirmText)) return
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const deleteAll = () =>
    run('all', 'Delete ALL of your sessions and location points? This cannot be undone.', async () => {
      const { data } = await api.deleteAllSessions()
      collector.clearDevice()
      setMessage(`Deleted ${data.deleted.sessions} sessions and ${data.deleted.observations} location points.`)
      setPage(1)
      load()
    })

  const withdraw = (deleteData) =>
    run(
      deleteData ? 'withdraw-delete' : 'withdraw',
      deleteData
        ? 'Withdraw consent AND delete all your data? Any running session stops immediately.'
        : 'Withdraw consent? Any running session stops. Data already contributed is kept unless you delete it.',
      async () => {
        const { data } = await api.withdrawConsent(deleteData)
        collector.clearDevice()
        setParticipant(data.participant)
        setMessage(deleteData ? 'Consent withdrawn and your data deleted.' : 'Consent withdrawn. No further data will be collected.')
        load()
      },
    )

  const deleteAccount = () =>
    run('account', 'Permanently delete your account and all contributed data?', async () => {
      await api.deleteAccount()
      collector.clearDevice()
      logout()
      navigate('/')
    })

  const total = result?.meta.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="My data" title="Your contributions">
        Everything here is visible only to you. Deleting a session removes its raw location points permanently.
      </PageHeader>

      {message && <Alert tone="ok" title={message} />}
      {error && <Alert tone="rec" title="Something went wrong">{error}</Alert>}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold"><MapIcon className="size-4 text-accent" aria-hidden /> Sessions ({total})</h2>
          {participant && (
            <Pill tone={participant.consentStatus === 'granted' ? 'ok' : 'neutral'}>
              consent {participant.consentStatus}{participant.consentVersion ? ` · v${participant.consentVersion}` : ''}
            </Pill>
          )}
        </div>
        {!result ? (
          <Spinner />
        ) : result.data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">You have not contributed any sessions yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {result.data.map((s) => (
              <SessionRow key={s.sessionId} session={s} activeLocally={local.sessionId === s.sessionId} onDeleted={load} />
            ))}
          </ul>
        )}
        {pages > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-sm">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="tabular text-muted">Page {page} of {pages}</span>
            <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold">Your choices</h2>
        <div className="mt-4 divide-y divide-line">
          <Choice title="Delete all my data" body="Removes every session and location point you contributed. Your account and consent stay as they are.">
            <Button variant="secondary" size="sm" onClick={deleteAll} loading={busy === 'all'} disabled={total === 0}>Delete all</Button>
          </Choice>
          {participant?.consentStatus === 'granted' && (
            <Choice title="Withdraw consent" body="Stops all collection. You can keep or delete what you already contributed.">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => withdraw(false)} loading={busy === 'withdraw'}>Withdraw</Button>
                <Button variant="secondary" size="sm" onClick={() => withdraw(true)} loading={busy === 'withdraw-delete'}>Withdraw and delete</Button>
              </div>
            </Choice>
          )}
          <Choice title="Delete my account" body="Deletes your sign-in, participant record and all data. Published aggregate statistics never contain your individual trace.">
            <Button variant="danger" size="sm" onClick={deleteAccount} loading={busy === 'account'}>Delete account</Button>
          </Choice>
        </div>
      </Card>
    </div>
  )
}

function Choice({ title, body, children }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-md">
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted">{body}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
