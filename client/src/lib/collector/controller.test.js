import { beforeEach, describe, expect, it } from 'vitest'
import { CollectorController, PHASE } from './controller'

const T0 = Date.UTC(2026, 9, 17, 8, 0)

function fakeGeo() {
  return {
    watching: false,
    onPos: null,
    onErr: null,
    watchPosition(onPos, onErr) {
      this.watching = true
      this.onPos = onPos
      this.onErr = onErr
      return 1
    },
    clearWatch() {
      this.watching = false
    },
    emit(t, coords = {}) {
      this.onPos?.({ timestamp: t, coords: { latitude: 21.25, longitude: 81.6, accuracy: 10, speed: null, heading: null, ...coords } })
    },
  }
}

/** Server double with the same (sessionId, sequence) idempotency as the real API. */
function fakeApi() {
  return {
    stored: new Map(),
    statuses: [],
    failNext: 0,
    failWith: { kind: 'network', message: 'offline' },
    async uploadObservations(sessionId, obs) {
      if (this.failNext > 0) {
        this.failNext -= 1
        throw this.failWith
      }
      let accepted = 0
      let duplicates = 0
      for (const o of obs) {
        if (this.stored.has(o.sequence)) duplicates += 1
        else {
          this.stored.set(o.sequence, o)
          accepted += 1
        }
      }
      return { data: { accepted, duplicates, rejected: [], totals: { acceptedObservationCount: this.stored.size } } }
    },
    async setSessionStatus(sessionId, status) {
      this.statuses.push(status)
      return { data: { collectionStatus: status } }
    },
  }
}

function memoryStorage() {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }
}

function manualTimers() {
  return { pending: [], setTimeout(fn) { this.pending.push(fn); return this.pending.length }, clearTimeout() {} }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

let geo, server, storage, ctl
const build = () =>
  new CollectorController({ api: server, geolocation: geo, storage, timers: manualTimers(), now: () => T0, random: () => 0.5, eagerBatchSize: 1000 })

beforeEach(() => {
  geo = fakeGeo()
  server = fakeApi()
  storage = memoryStorage()
  ctl = build()
  ctl.begin({ participantId: 'p1', sessionId: 'ses_1', samplingIntervalSeconds: 5 })
})

describe('CollectorController', () => {
  it('records throttled fixes with consecutive sequence numbers', () => {
    for (const dt of [0, 1000, 5000, 6000, 10000]) geo.emit(T0 + dt)
    expect(ctl.getSnapshot().queue.map((o) => [o.sequence, o.timestamp])).toEqual([
      [0, new Date(T0).toISOString()],
      [1, new Date(T0 + 5000).toISOString()],
      [2, new Date(T0 + 10000).toISOString()],
    ])
  })

  it('tracks live distance and a recent path, skipping GPS jumps', () => {
    geo.emit(T0)
    geo.emit(T0 + 5000, { latitude: 21.25005 }) // ~5.6 m
    geo.emit(T0 + 10000, { latitude: 21.26 }) // ~1.1 km in 5 s: jump, not walked
    const s = ctl.getSnapshot()
    expect(s.stats.distanceM).toBeGreaterThan(5)
    expect(s.stats.distanceM).toBeLessThan(6)
    expect(s.recent).toHaveLength(2) // the jump is left out of the preview
    expect(s.startedAtMs).toBe(T0)
  })

  it('never records while paused and syncs pause/resume to the server', async () => {
    geo.emit(T0)
    ctl.pause()
    expect(geo.watching).toBe(false)
    geo.emit(T0 + 10000) // a late callback must be ignored
    await settle()
    expect(ctl.getSnapshot().stats.recorded).toBe(1)
    expect(server.statuses).toEqual(['PAUSED'])
    ctl.resume()
    await settle()
    expect(geo.watching).toBe(true)
    expect(server.statuses).toEqual(['PAUSED', 'ACTIVE'])
  })

  it('keeps the queue through network failures and retries without duplicates', async () => {
    geo.emit(T0)
    geo.emit(T0 + 5000)
    server.failNext = 1
    await ctl.flush()
    let s = ctl.getSnapshot()
    expect(s.queue).toHaveLength(2)
    expect(s.upload.attempt).toBe(1)
    expect(s.upload.nextRetryAt).toBe(T0 + 1500)

    await ctl.flush()
    s = ctl.getSnapshot()
    expect(s.queue).toHaveLength(0)
    expect(s.stats.accepted).toBe(2)
    expect(server.stored.size).toBe(2)
  })

  it('treats a resend after a lost response as duplicates, not new data', async () => {
    geo.emit(T0)
    await ctl.flush()
    // Simulate the response having been lost: put the same observation back in the queue.
    ctl._set({ queue: [server.stored.get(0)] })
    await ctl.flush()
    expect(server.stored.size).toBe(1)
    expect(ctl.getSnapshot().stats.duplicates).toBe(1)
  })

  it('completes the session only after the queue is drained', async () => {
    geo.emit(T0)
    server.failNext = 1
    ctl.stop()
    await settle()
    expect(ctl.getSnapshot().phase).toBe(PHASE.FINISHING)
    expect(server.statuses).not.toContain('COMPLETED')
    await ctl.flush()
    expect(server.statuses.at(-1)).toBe('COMPLETED')
    expect(ctl.getSnapshot().phase).toBe(PHASE.DONE)
    expect(storage.getItem('campusflow.collector.v1')).toBeNull()
  })

  it('restores unsent data after a reload as PAUSED, never silently recording', async () => {
    geo.emit(T0)
    geo.emit(T0 + 5000)
    server.failNext = 99
    await ctl.flush()

    const geo2 = fakeGeo()
    geo = geo2
    server.failNext = 0
    const revived = build()
    expect(revived.restore('someone-else')).toBe(false)
    expect(revived.restore('p1')).toBe(true)
    await settle()
    const s = revived.getSnapshot()
    expect(s.phase).toBe(PHASE.PAUSED)
    expect(s.interrupted).toBe(true)
    expect(geo2.watching).toBe(false)
    expect(server.stored.size).toBe(2)
    expect(s.nextSequence).toBe(2)
  })

  it('stops and keeps data when consent is no longer valid', async () => {
    geo.emit(T0)
    server.failNext = 1
    server.failWith = { kind: 'http', status: 403, code: 'consent_required', message: 'consent' }
    await ctl.flush()
    const s = ctl.getSnapshot()
    expect(s.fatal.code).toBe('consent_required')
    expect(geo.watching).toBe(false)
  })

  it('discards the queue when the server has closed the session', async () => {
    geo.emit(T0)
    server.failNext = 1
    server.failWith = { kind: 'http', status: 409, code: 'session_closed', message: 'closed' }
    await ctl.flush()
    const s = ctl.getSnapshot()
    expect(s.phase).toBe(PHASE.DONE)
    expect(s.stats.discarded).toBe(1)
  })

  it('pauses when location permission is revoked', async () => {
    geo.onErr({ code: 1 })
    await settle()
    expect(ctl.getSnapshot().phase).toBe(PHASE.PAUSED)
    expect(ctl.getSnapshot().gps.error).toBe('permission_denied')
  })
})
