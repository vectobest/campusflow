import { describe, expect, it } from 'vitest'
import { backoffMs, haversineM, isRetryable, removeAcknowledged, shouldRecord, stepDistance, toObservation } from './core'

describe('shouldRecord', () => {
  it('records the first fix', () => expect(shouldRecord(1000, null, 5)).toBe(true))
  it('throttles to the sampling interval with small tolerance', () => {
    expect(shouldRecord(4000, 0, 5)).toBe(false)
    expect(shouldRecord(4800, 0, 5)).toBe(true)
    expect(shouldRecord(10000, 0, 5)).toBe(true)
  })
  it('drops re-delivered or older fixes', () => {
    expect(shouldRecord(5000, 5000, 0)).toBe(false)
    expect(shouldRecord(4000, 5000, 0)).toBe(false)
  })
  it('ignores non-finite timestamps', () => expect(shouldRecord(Number.NaN, null, 5)).toBe(false))
})

describe('toObservation', () => {
  const pos = (coords) => ({ timestamp: Date.UTC(2026, 9, 17, 8, 30), coords: { latitude: 21.25, longitude: 81.6, ...coords } })

  it('maps to the API schema with a UTC ISO timestamp', () => {
    expect(toObservation(pos({ accuracy: 12.5, speed: 1.2, heading: 85 }), 'ses_x', 4)).toEqual({
      sessionId: 'ses_x',
      sequence: 4,
      timestamp: '2026-10-17T08:30:00.000Z',
      latitude: 21.25,
      longitude: 81.6,
      accuracy: 12.5,
      speed: 1.2,
      heading: 85,
    })
  })

  it('records unavailable measurements as null, never guessed', () => {
    const o = toObservation(pos({ accuracy: undefined, speed: null, heading: Number.NaN }), 's', 0)
    expect([o.accuracy, o.speed, o.heading]).toEqual([null, null, null])
  })

  it('normalises heading 360 to 0 and drops negative speeds', () => {
    const o = toObservation(pos({ heading: 360, speed: -1 }), 's', 0)
    expect(o.heading).toBe(0)
    expect(o.speed).toBeNull()
  })
})

describe('upload helpers', () => {
  it('removes only acknowledged sequences', () => {
    const q = [0, 1, 2, 3].map((sequence) => ({ sequence }))
    expect(removeAcknowledged(q, [0, 2]).map((o) => o.sequence)).toEqual([1, 3])
  })
  it('backs off exponentially within a cap', () => {
    const mid = () => 0.5
    expect(backoffMs(0, { random: mid })).toBe(1500)
    expect(backoffMs(2, { random: mid })).toBe(6000)
    expect(backoffMs(20, { random: mid })).toBe(45000)
  })
  it('retries network, 5xx and 429 errors only', () => {
    expect(isRetryable({ kind: 'network' })).toBe(true)
    expect(isRetryable({ kind: 'http', status: 503 })).toBe(true)
    expect(isRetryable({ kind: 'http', status: 429 })).toBe(true)
    expect(isRetryable({ kind: 'http', status: 400 })).toBe(false)
    expect(isRetryable({ kind: 'http', status: 403 })).toBe(false)
  })
})

describe('live distance', () => {
  const at = (lat, lon, t, accuracy = 5) => ({ lat, lon, t, accuracy })
  it('haversine of 0.001 deg latitude is about 111 m', () => {
    expect(haversineM(21.25, 81.6, 21.251, 81.6)).toBeCloseTo(111.2, 0)
  })
  it('counts plausible walking steps', () => {
    expect(stepDistance(at(21.25, 81.6, 0), at(21.2501, 81.6, 10000))).toBeCloseTo(11.1, 0)
  })
  it('ignores poor-accuracy fixes and implausible jumps', () => {
    expect(stepDistance(at(21.25, 81.6, 0), at(21.2501, 81.6, 10000, 80))).toBe(0)
    expect(stepDistance(at(21.25, 81.6, 0), at(21.26, 81.6, 5000))).toBe(0)
    expect(stepDistance(null, at(21.25, 81.6, 0))).toBe(0)
  })
})
