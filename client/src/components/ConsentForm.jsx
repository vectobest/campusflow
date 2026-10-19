import { CheckCircle2, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Alert, Button, Card, Spinner } from './ui'

export default function ConsentForm() {
  const { participant, setParticipant } = useAuth()
  const [doc, setDoc] = useState(null)
  const [checked, setChecked] = useState({})
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.consentDocument().then((r) => setDoc(r.data)).catch((e) => setError(e.message))
  }, [])

  if (error && !doc) return <Alert tone="rec" title="Could not load the consent form">{error}</Alert>
  if (!doc) return <Spinner />

  const allChecked = doc.statements.every((s) => checked[s])
  const outdated = participant?.consentStatus === 'granted' && participant.consentVersion !== doc.version

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const { data } = await api.grantConsent(doc.version, doc.statements.filter((s) => checked[s]))
      setParticipant(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-brand-soft p-2.5 text-brand"><FileText className="size-5" aria-hidden /></div>
        <div>
          <h2 className="text-lg font-semibold">{doc.title}</h2>
          <p className="text-sm text-muted">Version {doc.version} · please read before taking part</p>
        </div>
      </div>

      {outdated && (
        <div className="mt-4">
          <Alert tone="warn" title="The consent form has changed">
            You agreed to version {participant.consentVersion}. Please review and agree to version {doc.version} before starting a new session.
          </Alert>
        </div>
      )}

      <div className="mt-5 space-y-4">
        {doc.sections.map((s) => (
          <div key={s.heading}>
            <h3 className="text-sm font-semibold text-ink">{s.heading}</h3>
            <p className="mt-1 text-[15px] leading-relaxed text-muted">{s.body}</p>
          </div>
        ))}
        <dl className="grid gap-2 rounded-xl bg-paper p-4 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Study contact</dt><dd className="font-medium">{doc.studyContact}</dd></div>
          <div><dt className="text-muted">Ethics approval</dt><dd className="font-medium">{doc.ethicsApproval}</dd></div>
        </dl>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-3 border-t border-line pt-5">
        <p className="text-sm font-medium">To take part, confirm each statement:</p>
        {doc.statements.map((s) => (
          <label key={s} className="flex cursor-pointer gap-3 rounded-xl border border-line p-3.5 text-[15px] has-[:checked]:border-accent has-[:checked]:bg-brand-soft/50">
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]"
              checked={!!checked[s]}
              onChange={(e) => setChecked((c) => ({ ...c, [s]: e.target.checked }))}
            />
            <span>{s}</span>
          </label>
        ))}
        {error && <Alert tone="rec" title="Consent was not recorded">{error}</Alert>}
        <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
          <Button type="submit" disabled={!allChecked} loading={saving}>
            <CheckCircle2 className="size-4" aria-hidden /> I agree to take part
          </Button>
          <span className="text-xs text-muted">Agreeing does not start recording. You start each session yourself.</span>
        </div>
      </form>
    </Card>
  )
}
