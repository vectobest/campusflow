import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from 'react-leaflet'
import { api } from '../api/client'
import { DARK_TILES } from './analytics/vizTokens'
import { Alert, Spinner } from './ui'

const MAX_POINTS = 20000

function FitBounds({ positions }) {
  const map = useMap()
  useEffect(() => {
    if (positions.length > 0) map.fitBounds(positions, { padding: [24, 24], maxZoom: 18 })
  }, [map, positions])
  return null
}

/**
 * The participant's OWN raw trace. Only reachable through the owner-only
 * observations endpoint; never used on any aggregate or public view.
 */
export default function TraceMap({ sessionId }) {
  const [points, setPoints] = useState(null)
  const [error, setError] = useState(null)
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const all = []
        let after = -1
        while (all.length < MAX_POINTS) {
          const { data, meta } = await api.sessionObservations(sessionId, after, 1000)
          all.push(...data)
          if (meta.nextAfterSequence == null) break
          after = meta.nextAfterSequence
        }
        if (!cancelled) {
          setTruncated(all.length >= MAX_POINTS)
          setPoints(all)
        }
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Draw in time order; out-of-order submissions are preserved in storage but sorted for display.
  const positions = useMemo(
    () => (points ?? []).slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).map((p) => [p.latitude, p.longitude]),
    [points],
  )

  if (error) return <Alert tone="rec" title="Could not load your trace">{error}</Alert>
  if (!points) return <Spinner />
  if (points.length === 0) return <p className="py-6 text-center text-sm text-muted">No accepted observations in this session.</p>

  return (
    <div>
      <div className="h-72 overflow-hidden rounded-lg border border-line">
        <MapContainer center={positions[0]} zoom={16} className="h-full w-full" scrollWheelZoom={false}>
          <TileLayer attribution={DARK_TILES.attribution} url={DARK_TILES.url} />
          <Polyline positions={positions} pathOptions={{ color: '#f59e0b', weight: 3, opacity: 0.9 }} />
          <CircleMarker center={positions[0]} radius={6} pathOptions={{ color: '#fafafa', weight: 2, fillColor: '#0a0a0f', fillOpacity: 1 }} />
          <CircleMarker center={positions[positions.length - 1]} radius={6} pathOptions={{ color: '#0a0a0f', weight: 2, fillColor: '#f59e0b', fillOpacity: 1 }} />
          <FitBounds positions={positions} />
        </MapContainer>
      </div>
      <p className="mt-2 text-xs text-muted">
        Raw, uncleaned trace ({points.length} points{truncated ? `, first ${MAX_POINTS} shown` : ''}). Only you can see this. GPS drift and jumps are normal here and are handled by the cleaning pipeline.
      </p>
    </div>
  )
}
