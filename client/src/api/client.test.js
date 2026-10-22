import { describe, expect, it } from 'vitest'
import { apiBaseUrl } from './client'

describe('apiBaseUrl', () => {
  it('uses the same origin by default', () => expect(apiBaseUrl({})).toBe('/api/v1'))
  it('uses an explicit full URL without a trailing slash', () =>
    expect(apiBaseUrl({ VITE_API_BASE_URL: 'https://api.example.com/api/v1/' })).toBe('https://api.example.com/api/v1'))
  it('builds an https URL from a bare host', () =>
    expect(apiBaseUrl({ VITE_API_HOST: 'campusflow-api.onrender.com' })).toBe('https://campusflow-api.onrender.com/api/v1'))
})

describe('withRetry', async () => {
  const { withRetry } = await import('./client')
  it('retries network errors, then succeeds', async () => {
    let n = 0
    const out = await withRetry(async () => {
      n += 1
      if (n < 3) throw { kind: 'network' }
      return 'ok'
    }, { delayMs: 1 })
    expect([out, n]).toEqual(['ok', 3])
  })
  it('does not retry HTTP errors', async () => {
    let n = 0
    await expect(withRetry(async () => { n += 1; throw { kind: 'http', status: 401 } }, { delayMs: 1 })).rejects.toEqual({ kind: 'http', status: 401 })
    expect(n).toBe(1)
  })
  it('gives up after the last attempt', async () => {
    let n = 0
    await expect(withRetry(async () => { n += 1; throw { kind: 'network' } }, { attempts: 2, delayMs: 1 })).rejects.toEqual({ kind: 'network' })
    expect(n).toBe(2)
  })
})
