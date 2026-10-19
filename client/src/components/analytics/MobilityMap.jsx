import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo } from 'react'
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { CLUSTER_MUTED, CLUSTER_SELECTED, CORRIDOR, DARK_TILES, REGION_FILL, REGION_STROKE, SEQ, hourLabel, seqColor } from './vizTokens'

function FitTo({ bounds }) {
  const map = useMap()
  useEffect(() => {
    if (bounds.length) map.fitBounds(bounds, { padding: [20, 20] })
  }, [map, bounds])
  return null
}

/**
 * Aggregate-only campus map. Every layer comes from the analysis result, which
 * already withheld groups smaller than the privacy threshold; no individual
 * trajectory is ever drawn (cluster lines are averages of several people's trips).
 */
export default function MobilityMap({ result, layers, hour, selectedCluster, onSelectCluster }) {
  const bounds = useMemo(() => {
    const pts = [
      ...result.zones.flatMap((z) => z.polygon),
      ...result.stayRegions.map((r) => [r.latitude, r.longitude]),
    ]
    return pts
  }, [result])

  const synthetic = result.dataOrigin === 'synthetic'
  const zoneValue = (z) => (hour === 'all' ? z.totalParticipants : z.hours[hour]?.participantDays ?? null)
  const zoneMax = Math.max(0, ...result.zones.map((z) => zoneValue(z) ?? 0))
  const maxTrips = Math.max(1, ...result.corridors.map((c) => c.trips))
  const maxVisits = Math.max(1, ...result.stayRegions.map((r) => r.visits))

  if (bounds.length === 0) {
    return <div className="grid h-full place-items-center text-sm text-muted">Nothing to map: every aggregate was below the privacy threshold.</div>
  }

  return (
    <MapContainer center={bounds[0]} zoom={16} className={`h-full w-full ${synthetic ? 'grid-bg' : ''}`} scrollWheelZoom>
      {/* Synthetic data is drawn without a street map so it can never be mistaken for real campus movement. */}
      {!synthetic && <TileLayer attribution={DARK_TILES.attribution} url={DARK_TILES.url} />}
      <FitTo bounds={bounds} />

      {layers.zones &&
        result.zones.map((z) => {
          const v = zoneValue(z)
          if (v == null) return null
          return (
            <Polygon
              key={z.cellId}
              positions={z.polygon}
              pathOptions={{ stroke: true, color: '#0a0a0f', weight: 1, fillColor: seqColor(v, zoneMax), fillOpacity: 0.8 }}
            >
              <Tooltip sticky>
                <strong>{hour === 'all' ? 'All hours' : hourLabel(hour)}</strong>
                <br />
                {hour === 'all' ? `${v} distinct participants` : `${v} participant-days · ${z.hours[hour].participants} participants`}
              </Tooltip>
            </Polygon>
          )
        })}

      {layers.corridors &&
        result.corridors.map((c) => (
          <Polyline
            key={`${c.from}-${c.to}`}
            positions={c.line}
            pathOptions={{ color: CORRIDOR, weight: 1.5 + 6 * (c.trips / maxTrips), opacity: 0.2 + 0.75 * (c.trips / maxTrips), lineCap: 'round' }}
          >
            <Tooltip sticky>{c.trips} trips · {c.participants} participants</Tooltip>
          </Polyline>
        ))}

      {layers.clusters &&
        result.clusters
          .filter((c) => c.meanPath)
          // Draw the selected cluster last so it sits on top.
          .sort((a, b) => (a.clusterId === selectedCluster) - (b.clusterId === selectedCluster))
          .map((c) => {
            const on = c.clusterId === selectedCluster
            return (
              <Polyline
                key={c.clusterId}
                positions={c.meanPath}
                eventHandlers={{ click: () => onSelectCluster(c.clusterId) }}
                pathOptions={{ color: on ? CLUSTER_SELECTED : CLUSTER_MUTED, weight: on ? 5 : 2.5, opacity: on ? 1 : 0.6, dashArray: on ? null : '5 7' }}
              >
                <Tooltip sticky>Cluster {c.clusterId}: {c.trips} trips · {c.participants} participants</Tooltip>
              </Polyline>
            )
          })}
      {layers.clusters &&
        result.clusters
          .filter((c) => c.meanPath && c.clusterId === selectedCluster)
          .map((c) => (
            <CircleMarker key={`end-${c.clusterId}`} center={c.meanPath[c.meanPath.length - 1]} radius={6} pathOptions={{ color: '#0a0a0f', weight: 2, fillColor: CLUSTER_SELECTED, fillOpacity: 1 }}>
              <Tooltip>Cluster {c.clusterId} direction: ends here</Tooltip>
            </CircleMarker>
          ))}

      {layers.regions &&
        result.stayRegions.map((r) => (
          <CircleMarker
            key={r.regionId}
            center={[r.latitude, r.longitude]}
            radius={6 + 14 * Math.sqrt(r.visits / maxVisits)}
            pathOptions={{ color: REGION_STROKE, weight: 2, fillColor: REGION_FILL, fillOpacity: 0.85 }}
          >
            <Tooltip>
              <strong>{r.name}</strong>
              {r.placeVerification && ` (${r.placeVerification})`}
              <br />
              {r.visits} visits · {r.distinctParticipants} participants · median stay {r.medianDwellMin} min
            </Tooltip>
          </CircleMarker>
        ))}
    </MapContainer>
  )
}

export function MapLegend({ layers, hour }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
      {layers.zones && (
        <div className="flex items-center gap-2">
          <span>{hour === 'all' ? 'Participants' : 'Participant-days'}: low</span>
          <span className="flex overflow-hidden rounded-sm">{SEQ.slice(1).map((c) => <span key={c} className="h-3 w-5" style={{ background: c }} />)}</span>
          <span>high</span>
        </div>
      )}
      {layers.corridors && (
        <div className="flex items-center gap-2"><span className="h-1.5 w-6 rounded-full" style={{ background: CORRIDOR }} />Frequent path (brighter, wider = more trips)</div>
      )}
      {layers.regions && (
        <div className="flex items-center gap-2"><span className="size-3 rounded-full border-2" style={{ background: REGION_FILL, borderColor: REGION_STROKE }} />Stay region (larger = more visits)</div>
      )}
      {layers.clusters && (
        <div className="flex items-center gap-2"><span className="h-1 w-6 rounded-full" style={{ background: CLUSTER_SELECTED }} />Selected cluster mean path (dot = end)</div>
      )}
    </div>
  )
}
