import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

const GSI_SRC = 'https://accounts.google.com/gsi/client'
let gsiPromise = null

/** Load Google Identity Services once per page. */
function loadGsi() {
  gsiPromise ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google)
    const script = document.createElement('script')
    script.src = GSI_SRC
    script.async = true
    script.onload = () => resolve(window.google)
    script.onerror = () => {
      gsiPromise = null
      reject(new Error('Could not load Google sign-in'))
    }
    document.head.appendChild(script)
  })
  return gsiPromise
}

/**
 * "Sign in with Google" (Google Identity Services, OpenID Connect). Renders
 * nothing unless the API reports a configured client ID. On success, Google
 * hands us a signed ID token (`credential`) which the API verifies.
 */
export default function GoogleSignInButton({ onCredential, text = 'continue_with' }) {
  const ref = useRef(null)
  const [state, setState] = useState('loading') // loading | ready | unavailable | error
  const callback = useRef(onCredential)
  callback.current = onCredential

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.authConfig()
        if (!data.googleClientId) return !cancelled && setState('unavailable')
        const google = await loadGsi()
        if (cancelled || !ref.current) return
        google.accounts.id.initialize({
          client_id: data.googleClientId,
          callback: (resp) => callback.current(resp.credential),
          ux_mode: 'popup',
          context: 'signin',
        })
        google.accounts.id.renderButton(ref.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'rectangular',
          text,
          logo_alignment: 'center',
          width: Math.min(400, ref.current.offsetWidth || 320),
        })
        setState('ready')
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [text])

  if (state === 'unavailable') return null
  return (
    <div>
      <div ref={ref} className="flex min-h-11 w-full justify-center [color-scheme:light]" aria-busy={state === 'loading'} />
      {state === 'error' && <p className="mt-2 text-center text-xs text-faint">Google sign-in could not be loaded. You can still use email and password.</p>}
      <OrDivider />
    </div>
  )
}

function OrDivider() {
  return (
    <div className="my-6 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-faint" aria-hidden>
      <span className="h-px flex-1 bg-line" />
      or
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}
