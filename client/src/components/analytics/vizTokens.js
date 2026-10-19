// Chart colour roles for the dark theme.
// SERIES: dark-mode steps of the reference palette, validated on #12121A
// (CVD ΔE 26.8, normal-vision ΔE 31.8, both >= 3:1 contrast).
export const SERIES = { weekday: '#3987e5', weekend: '#d95926' }

// Crowded zones: one-hue amber ramp, dim -> bright, so "more activity" glows on the dark map.
export const SEQ = ['#2a1a05', '#4a2c06', '#78420a', '#a85d0b', '#d97706', '#f59e0b', '#fbbf24']

export const INK = { primary: '#fafafa', secondary: '#a1a1aa', muted: '#8b8b94', grid: 'rgba(255,255,255,0.06)' }

// Frequent paths: neutral light trails (intensity = opacity + width), distinct from the amber zones.
export const CORRIDOR = '#fafafa'
export const REGION_FILL = '#0a0a0f'
export const REGION_STROKE = '#fafafa'
export const CLUSTER_MUTED = '#71717a'
export const CLUSTER_SELECTED = '#a78bfa'

/** Map a value in [0, max] to a ramp step (step 0 is the near-surface "almost nothing" tone). */
export function seqColor(value, max) {
  if (!max || value == null) return SEQ[0]
  const idx = Math.min(SEQ.length - 1, 1 + Math.floor((value / max) * (SEQ.length - 1)))
  return SEQ[idx]
}

export const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`

export const DARK_TILES = {
  url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
}
