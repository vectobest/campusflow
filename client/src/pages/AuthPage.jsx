import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import GoogleSignInButton from '../components/GoogleSignInButton'
import { Alert, Button, Card, Field, PageHeader, inputClass } from '../components/ui'
import { collector } from '../hooks/useCollector'

export default function AuthPage({ mode }) {
  const { login, register, loginWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next')?.startsWith('/') ? params.get('next') : '/contribute'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const isRegister = mode === 'register'

  const signIn = async (action) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      // Resume any upload that stopped because the previous sign-in expired.
      if (collector.getSnapshot().fatal?.code === 'unauthenticated') collector.clearFatal()
      navigate(next, { replace: true })
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message)
    } finally {
      setBusy(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    signIn(() => (isRegister ? register : login)(email, password))
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader eyebrow="CampusFlow" title={isRegister ? 'Create your account' : 'Sign in'}>
        {isRegister
          ? 'Your email is used only to sign in. Research data is linked to a separate random identifier.'
          : 'Sign in to contribute or to manage your data.'}
      </PageHeader>
      <Card>
        <GoogleSignInButton text={isRegister ? 'signup_with' : 'signin_with'} onCredential={(credential) => signIn(() => loginWithGoogle(credential))} />
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" hint={isRegister ? 'At least 10 characters.' : undefined}>
            <input
              className={inputClass}
              type="password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              required
              minLength={isRegister ? 10 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <Alert tone="rec" title={isRegister ? 'Could not create account' : 'Could not sign in'}>{error}</Alert>}
          <Button type="submit" className="w-full" loading={busy}>{isRegister ? 'Create account' : 'Sign in'}</Button>
        </form>
        <p className="mt-5 text-center text-sm text-muted">
          {isRegister ? 'Already registered? ' : 'New to CampusFlow? '}
          <Link className="font-medium text-brand" to={`${isRegister ? '/login' : '/register'}?next=${encodeURIComponent(next)}`}>
            {isRegister ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
      </Card>
    </div>
  )
}
