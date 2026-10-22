import { useEffect, useState } from 'react'
import { api, withRetry } from '../api/client'

let wakePromise = null

/** Ping the API once per page load so a sleeping free-tier server starts waking immediately. */
export function wakeServer() {
  wakePromise ??= withRetry(() => api.health(), { attempts: 5, delayMs: 3000 }).then(
    () => true,
    () => {
      wakePromise = null
      return false
    },
  )
  return wakePromise
}

/**
 * 'checking' → 'ready' normally. Turns 'waking' if the API has not answered
 * within 2.5 s (it is starting up), and 'down' if it never answers.
 */
export function useServerStatus() {
  const [status, setStatus] = useState('checking')
  useEffect(() => {
    let done = false
    const slow = setTimeout(() => !done && setStatus('waking'), 2500)
    wakeServer().then((ok) => {
      done = true
      clearTimeout(slow)
      setStatus(ok ? 'ready' : 'down')
    })
    return () => {
      done = true
      clearTimeout(slow)
    }
  }, [])
  return status
}
