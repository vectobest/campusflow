import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import CollectorPanel from '../components/CollectorPanel'
import ConsentForm from '../components/ConsentForm'
import { Alert, Card, PageHeader, Spinner, buttonClass } from '../components/ui'
import { isCollecting, useCollector } from '../hooks/useCollector'

export default function Contribute() {
  const { loading, user, participant } = useAuth()
  const s = useCollector()
  const [consentVersion, setConsentVersion] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.collectionConfig().then((r) => setConsentVersion(r.data.consentVersion)).catch((e) => setError(e.message))
  }, [])

  if (loading) return <Spinner />

  if (!user) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader eyebrow="Contribute" title="Share your campus movement, on your terms">
          An account lets you control your contribution: review it, delete it, or withdraw at any time. Your email is stored separately from your research data.
        </PageHeader>
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link to="/register?next=/contribute" className={buttonClass()}>Create an account</Link>
            <Link to="/login?next=/contribute" className={buttonClass({ variant: 'secondary' })}>I already have one</Link>
          </div>
        </Card>
      </div>
    )
  }

  if (!participant) return <Card>This account is not set up as a study participant.</Card>
  if (error) return <Alert tone="rec" title="Could not reach the CampusFlow server">{error}</Alert>
  if (!consentVersion) return <Spinner />

  // A session that is already running or uploading stays manageable regardless.
  const needsConsent =
    !isCollecting(s) && (participant.consentStatus !== 'granted' || participant.consentVersion !== consentVersion)

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow="Contribute" title={needsConsent ? 'Informed consent' : 'GPS collection'}>
        {needsConsent
          ? 'Please read how your data is collected and used. Nothing is recorded until you start a session.'
          : 'Your location is recorded only while a session is running on this page.'}
      </PageHeader>
      {needsConsent ? <ConsentForm /> : <CollectorPanel />}
    </div>
  )
}
