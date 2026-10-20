import { describe, expect, it } from 'vitest'
import { apiBaseUrl } from './client'

describe('apiBaseUrl', () => {
  it('uses the same origin by default', () => expect(apiBaseUrl({})).toBe('/api/v1'))
  it('uses an explicit full URL without a trailing slash', () =>
    expect(apiBaseUrl({ VITE_API_BASE_URL: 'https://api.example.com/api/v1/' })).toBe('https://api.example.com/api/v1'))
  it('builds an https URL from a bare host', () =>
    expect(apiBaseUrl({ VITE_API_HOST: 'campusflow-api.onrender.com' })).toBe('https://campusflow-api.onrender.com/api/v1'))
})
