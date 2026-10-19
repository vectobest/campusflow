import { FlaskConical, Pause, Play, Terminal } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { ClustersSection, HourlyChart, QualitySection, RoutesSection, SectionTitle, SequencesSection, StayRegionsTable, TopZones } from '../components/analytics/Sections'
import { hourLabel } from '../components/analytics/vizTokens'
import { Alert, Card, PageHeader, Pill, Spinner, Stat, buttonClass, formatDateTime } from '../components/ui'

const MobilityMap = lazy(() => import('../components/analytics/MobilityMap'))
const MapLegendLazy = lazy(() => import('../components/analytics/MobilityMap').then((m) => ({ default: m.MapLegend })))

const LAYERS = [
  ['zones', 'Crowded zones'],
  ['corridors', 'Frequent paths'],
  ['regions', 'Stay regions'],
  ['clusters', 'Route clusters'],
]

function NoResults({ datasetId }) {
  return (
    <Card>
      <div className="flex gap-3">
        <Terminal className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
        <div className="text-sm text-muted">
          <p className="font-medium text-ink">No analysis has been run{datasetId ? ` for ${datasetId}` : ''} yet.</p>
          <p className="mt-1">From the repository root, run:</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-paper p-3 font-mono text-xs text-ink">npm run analyze -- --dataset nitrr-campus-collected --places analytics/places/nitrr_places.geojson</pre>
          <p className="mt-2">Only finished sessions are analysed. Results appear here after the run completes.</p>
        </div>
      </div>
    </Card>
  )
}

export default function Analytics() {
  const [datasets, setDatasets] = useState(null)
  const [datasetId, setDatasetId] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [layers, setLayers] = useState({ zones: true, corridors: true, regions: true, clusters: false })
  const [hour, setHour] = useState('all')
  const [cluster, setCluster] = useState(null)
  const [playing, setPlaying] = useState(false)

  // Hours that have at least one visible zone: the "day playback" steps through these.
  const activeHours = useMemo(
    () => (result ? Array.from({ length: 24 }, (_, h) => h).filter((h) => result.zones.some((z) => z.hours[h])) : []),
    [result],
  )

  // Advance one active hour per tick; stop after the last one.
  useEffect(() => {
    if (!playing) return undefined
    const i = hour === 'all' ? -1 : activeHours.indexOf(hour)
    const id = setTimeout(() => {
      if (i + 1 >= activeHours.length) setPlaying(false)
      else setHour(activeHours[i + 1])
    }, 1100)
    return () => clearTimeout(id)
  }, [playing, hour, activeHours])

  const togglePlay = () => {
    if (!playing) {
      setLayers((l) => ({ ...l, zones: true }))
      if (hour === 'all' || hour === activeHours[activeHours.length - 1]) setHour(activeHours[0] ?? 'all')
    }
    setPlaying((p) => !p)
  }

  useEffect(() => {
    api
      .analyticsResults()
      .then(({ data }) => {
        setDatasets(data)
        // Prefer real collected data over synthetic when both exist.
        const pick = data.find((d) => d.dataOrigin === 'collected') ?? data[0]
        if (pick) setDatasetId(pick.datasetId)
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!datasetId) return
    setResult(null)
    api
      .analyticsResult(datasetId)
      .then(({ data }) => {
        setResult(data)
        setCluster(data.clusters.find((c) => c.meanPath)?.clusterId ?? null)
      })
      .catch((e) => setError(e.message))
  }, [datasetId])

  const selectCluster = (id) => {
    setCluster(id)
    setLayers((l) => ({ ...l, clusters: true }))
  }

  if (error) return <Alert tone="rec" title="Could not load analytics">{error}</Alert>
  if (!datasets) return <Spinner />

  const s = result?.summary
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Analytics" title="Campus mobility patterns">
        Aggregates computed from finished GPS sessions: where people stop, which paths they use, when and where activity peaks, which visit
        sequences recur, and which routes are alike. Groups with fewer than the privacy threshold of participants are never shown.
      </PageHeader>

      {datasets.length === 0 ? (
        <NoResults />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {datasets.map((d) => (
            <button
              key={d.datasetId}
              onClick={() => setDatasetId(d.datasetId)}
              className={`h-9 rounded-lg border px-3 font-mono text-sm transition-all duration-200 ${d.datasetId === datasetId ? 'border-brand/40 bg-brand-soft text-brand shadow-[var(--shadow-glow-sm)]' : 'border-line bg-card text-muted hover:border-line-strong hover:text-ink'}`}
            >
              {d.datasetId} <span className="font-sans text-xs">({d.dataOrigin})</span>
            </button>
          ))}
        </div>
      )}

      {datasetId && !result && <Spinner />}

      {result && (
        <>
          {result.dataOrigin === 'synthetic' && (
            <Alert tone="warn" icon={FlaskConical} title="Synthetic demonstration data">
              Generated around fictional places to test the pipeline. These numbers are not observations of NIT Raipur and must not be presented as findings.
            </Alert>
          )}

          <div className="tabular text-xs text-muted">
            Run {formatDateTime(result.generatedAt)} · algorithm v{result.algorithmVersion} · data {formatDateTime(result.summary.coverage.start)} → {formatDateTime(result.summary.coverage.end)} · privacy threshold {result.params.min_participants} participants
          </div>

          <Card>
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
              <Stat label="Participants" value={s.participants ?? `< ${result.params.min_participants}`} hint="distinct contributors" accent />
              <Stat label="Sessions" value={s.sessions} hint={`${s.trajectories} trajectories`} />
              <Stat label="Trips" value={s.trips} hint={`${s.totalDistanceKm} km walked`} />
              <Stat label="Visits" value={s.visits} hint={`median stay ${s.medianDwellMin ?? '—'} min`} />
              <Stat label="Stay regions" value={s.stayRegions} hint={`from ${s.stayPoints} stay points`} />
              <Stat label="Path edges" value={s.frequentCorridorEdges} hint="frequent grid steps" />
              <Stat label="Patterns" value={s.frequentPatterns} hint={`PrefixSpan, ${s.sequences} sequences`} />
              <Stat label="Clusters" value={s.trajectoryClusters} hint={`${s.noiseTrips} noise trips`} />
            </div>
          </Card>

          <Card className="!p-0 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
              {LAYERS.map(([key, label]) => (
                <label key={key} className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-muted transition-all duration-200 hover:border-line-strong hover:text-ink has-[:checked]:border-brand/40 has-[:checked]:bg-brand-soft has-[:checked]:text-brand has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent">
                  <input type="checkbox" className="sr-only" checked={layers[key]} onChange={(e) => setLayers((l) => ({ ...l, [key]: e.target.checked }))} />
                  {label}
                </label>
              ))}
              <div className="ml-auto flex items-center gap-3 text-sm">
                <button
                  onClick={togglePlay}
                  disabled={activeHours.length === 0}
                  className={buttonClass({ variant: playing ? 'secondary' : 'primary', size: 'sm' })}
                  aria-pressed={playing}
                >
                  {playing ? <Pause size={15} strokeWidth={1.75} /> : <Play size={15} strokeWidth={1.75} />}
                  {playing ? 'Pause' : 'Play the day'}
                </button>
                <input
                  type="range"
                  min={-1}
                  max={23}
                  value={hour === 'all' ? -1 : hour}
                  onChange={(e) => {
                    setPlaying(false)
                    setHour(Number(e.target.value) < 0 ? 'all' : Number(e.target.value))
                  }}
                  className="w-32 sm:w-40"
                  aria-label="Hour of day for crowded zones"
                />
                <Pill tone="brand">{hour === 'all' ? 'All hours' : hourLabel(hour)}</Pill>
              </div>
            </div>
            <div className="grid lg:grid-cols-[1fr_17rem]">
              <div className="relative h-[28rem]">
                {result.dataOrigin === 'synthetic' && (
                  <div className="pointer-events-none absolute top-3 right-3 z-[500] rounded-md border border-warn/30 bg-paper/80 px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide text-warn backdrop-blur">
                    SYNTHETIC DATA · no basemap
                  </div>
                )}
                {hour !== 'all' && layers.zones && (
                  <div className="pointer-events-none absolute bottom-4 left-4 z-[500] rounded-lg border border-line bg-paper/75 px-4 py-2 backdrop-blur" aria-live="polite">
                    <div className="tabular font-display text-3xl font-semibold text-brand [text-shadow:0_0_24px_rgba(245,158,11,0.5)]">{hourLabel(hour)}</div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">local time · crowded zones</div>
                  </div>
                )}
                <Suspense fallback={<Spinner />}>
                  <MobilityMap result={result} layers={layers} hour={hour} selectedCluster={cluster} onSelectCluster={selectCluster} />
                </Suspense>
              </div>
              <div className="space-y-4 border-t border-line p-4 lg:border-l lg:border-t-0">
                <TopZones result={result} hour={hour} />
                <p className="text-xs leading-relaxed text-muted">
                  Zones are {result.params.grid_cell_m} m cells coloured by participant-days in the chosen hour: observed activity among study participants,
                  not the number of people physically there.
                </p>
              </div>
            </div>
            <div className="border-t border-line p-4">
              <Suspense fallback={null}><MapLegendLazy layers={layers} hour={hour} /></Suspense>
            </div>
          </Card>

          <HourlyChart hourly={result.hourlyActivity} timezone={result.params.timezone} days={result.collectionDays} />
          <StayRegionsTable result={result} />
          <RoutesSection result={result} />
          <SequencesSection result={result} />
          <ClustersSection result={result} selected={cluster} onSelect={selectCluster} />
          <section>
            <SectionTitle title="Method checks" />
            <QualitySection result={result} />
          </section>
        </>
      )}
    </div>
  )
}
