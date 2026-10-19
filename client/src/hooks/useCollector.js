import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../api/client'
import { CollectorController, PHASE } from '../lib/collector/controller'

const unsupportedGeo = {
  watchPosition: (_ok, err) => {
    err({ code: 2, message: 'Geolocation is not supported by this browser' })
    return null
  },
  clearWatch: () => {},
}

const memoryFallback = (() => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }
})()

function pickStorage() {
  try {
    const t = '__cf_probe__'
    localStorage.setItem(t, t)
    localStorage.removeItem(t)
    return localStorage
  } catch {
    return memoryFallback
  }
}

// One controller per tab: collection state must survive route changes.
export const collector = new CollectorController({
  api,
  geolocation: typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : unsupportedGeo,
  storage: pickStorage(),
})

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => collector.retryNow())
}

export function useCollector() {
  return useSyncExternalStore(collector.subscribe, collector.getSnapshot)
}

export const isCollecting = (s) => s.phase === PHASE.RECORDING || s.phase === PHASE.PAUSED || s.phase === PHASE.FINISHING

/** Keep the screen awake while recording, where the Screen Wake Lock API exists. */
export function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return undefined
    let lock = null
    let cancelled = false
    const acquire = async () => {
      try {
        if (document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen')
      } catch {
        /* denied or unsupported: recording still works, the screen may just sleep */
      }
      if (cancelled && lock) lock.release().catch(() => {})
    }
    acquire()
    const onVis = () => document.visibilityState === 'visible' && acquire()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
      lock?.release().catch(() => {})
    }
  }, [active])
}

/** Tracks how long the page spent hidden, since browsers may suspend geolocation then. */
export function useBackgroundGaps(active, onReturn) {
  useEffect(() => {
    if (!active) return undefined
    let hiddenAt = null
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else if (hiddenAt) {
        onReturn(Date.now() - hiddenAt)
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [active, onReturn])
}
