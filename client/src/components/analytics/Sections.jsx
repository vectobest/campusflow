import { ArrowRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, Pill } from '../ui'
import { INK, SERIES, hourLabel } from './vizTokens'

export function SectionTitle({ title, children }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{children}</p>}
    </div>
  )
}

function Table({ head, rows, empty = 'Nothing passed the thresholds.' }) {
  if (!rows.length) return <p className="py-4 text-sm text-muted">{empty}</p>
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted">
          <tr>{head.map((h) => <th key={h} className="px-1 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="tabular divide-y divide-line">{rows}</tbody>
      </table>
    </div>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-ink">{hourLabel(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="mt-1 flex items-center gap-2 text-muted">
          <span className="size-2.5 rounded-sm" style={{ background: p.color }} />
          {p.name}: <span className="font-medium text-ink">{p.value != null ? `${p.value} per day` : 'hidden'}</span>
        </div>
      ))}
    </div>
  )
}

/** RQ3: campus-wide activity by local hour, weekday vs weekend (participant-days). */
export function HourlyChart({ hourly, timezone, days }) {
  const [table, setTable] = useState(false)
  const data = hourly.map((h) => ({ hour: h.hour, weekday: h.weekdayAvgPerDay, weekend: h.weekendAvgPerDay }))
  const hidden = hourly.filter((h) => h.weekdayAvgPerDay == null || h.weekendAvgPerDay == null).length
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <SectionTitle title="Activity by hour of day">
          Average number of participants active in each local hour ({timezone}) per collection day: {days.weekday} weekdays and {days.weekend} weekend
          days had data. A participant active all hour counts once, however many GPS points they sent.
          {hidden > 0 && ` Bars resting on fewer participants than the privacy threshold are hidden (${hidden} hours affected).`}
        </SectionTitle>
        <button className="text-sm font-medium text-brand" onClick={() => setTable((t) => !t)}>{table ? 'Show chart' : 'Show table'}</button>
      </div>
      {table ? (
        <Table
          head={['Hour', 'Weekday avg / day', 'Weekend avg / day', 'Participant-days (all)']}
          rows={hourly.map((h) => (
            <tr key={h.hour}>
              <td className="px-1 py-1.5">{hourLabel(h.hour)}</td>
              <td className="px-1">{h.weekdayAvgPerDay ?? '—'}</td>
              <td className="px-1">{h.weekendAvgPerDay ?? '—'}</td>
              <td className="px-1">{h.participantDays ?? 'suppressed'}</td>
            </tr>
          ))}
        />
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={2} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={INK.grid} />
              <XAxis dataKey="hour" tickFormatter={(h) => (h % 3 === 0 ? String(h).padStart(2, '0') : '')} tick={{ fill: INK.secondary, fontSize: 12 }} axisLine={{ stroke: INK.grid }} tickLine={false} interval={0} />
              <YAxis tick={{ fill: INK.secondary, fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: INK.secondary }}>{v}</span>} />
              <Bar dataKey="weekday" name="Weekday" fill={SERIES.weekday} radius={[4, 4, 0, 0]} maxBarSize={14} />
              <Bar dataKey="weekend" name="Weekend" fill={SERIES.weekend} radius={[4, 4, 0, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

function Spark({ values }) {
  const max = Math.max(1, ...values)
  return (
    <div className="flex h-6 items-end gap-px" aria-label="Arrivals by hour, 00 to 23">
      {values.map((v, h) => (
        <span key={h} title={`${hourLabel(h)}: ${v}`} className="w-1 rounded-t-sm" style={{ height: `${Math.max(v ? 12 : 4, (v / max) * 100)}%`, background: v ? SERIES.weekday : INK.grid }} />
      ))}
    </div>
  )
}

/** RQ2: where people stop. */
export function StayRegionsTable({ result }) {
  return (
    <Card>
      <SectionTitle title="Stay points → stay regions">
        {result.summary.stayPoints} stay points (≥ {result.params.stay_min_duration_s / 60} min within {result.params.stay_distance_m} m) were grouped into
        regions where several participants stop. A region gets a place name only if a verified place lies within {result.params.place_match_m} m;
        GPS cannot tell what anyone did there.
        {result.suppressedRegions > 0 && ` ${result.suppressedRegions} regions with too few participants are hidden.`}
      </SectionTitle>
      <Table
        head={['Region', 'Visits', 'Participants', 'Median stay', 'Weekday / weekend', 'Arrivals by hour']}
        rows={result.stayRegions.map((r) => (
          <tr key={r.regionId}>
            <td className="px-1 py-2">
              <div className="font-medium">{r.name}</div>
              <div className="text-xs text-muted">
                {r.placeVerification ? `${r.category} · ${r.placeVerification} · ${r.placeDistanceM} m away` : 'no verified place nearby'}
              </div>
            </td>
            <td className="px-1">{r.visits}</td>
            <td className="px-1">{r.distinctParticipants}</td>
            <td className="px-1">{r.medianDwellMin} min</td>
            <td className="px-1">{r.weekdayVisits} / {r.weekendVisits}</td>
            <td className="px-1"><Spark values={r.arrivalsByHour} /></td>
          </tr>
        ))}
      />
    </Card>
  )
}

/** RQ4: top zones for the hour picked on the map. */
export function TopZones({ result, hour }) {
  const row = hour === 'all' ? null : result.topZonesByHour[hour]
  const cells = row ? row.cells : [...result.zones].sort((a, b) => b.totalParticipants - a.totalParticipants).slice(0, 5).map((z) => ({ cellId: z.cellId, participants: z.totalParticipants }))
  return (
    <div>
      <h3 className="text-sm font-semibold">Busiest zones · {hour === 'all' ? 'all hours' : hourLabel(hour)}</h3>
      {cells.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No zone reaches the privacy threshold in this hour.</p>
      ) : (
        <ol className="mt-2 space-y-1 text-sm">
          {cells.map((c, i) => (
            <li key={c.cellId} className="tabular flex justify-between gap-3">
              <span className="text-muted">{i + 1}. cell {c.cellId}</span>
              <span>{c.participantDays != null ? `${c.participantDays} participant-days` : `${c.participants} participants`}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

const regionName = (result) => {
  const m = Object.fromEntries(result.stayRegions.map((r) => [r.regionId, r.name]))
  return (id) => m[id] ?? id
}

function Chain({ names }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {names.map((n, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ArrowRight className="size-3.5 text-muted" aria-hidden />}
          <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-xs font-medium text-brand">{n}</span>
        </span>
      ))}
    </span>
  )
}

/** RQ5: PrefixSpan patterns + direct transitions. */
export function SequencesSection({ result }) {
  const name = regionName(result)
  const [minLen, setMinLen] = useState(2)
  const patterns = result.sequencePatterns.filter((p) => p.length >= minLen)
  const maxSupport = Math.max(1, ...result.sequencePatterns.map((p) => p.support))
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle title="Frequent visit sequences (PrefixSpan)">
          Each session becomes the ordered list of stay regions it visited. A pattern is supported by a session if its regions occur in that order
          (other stops may come in between). Support = sessions, out of {result.summary.sequences}; minimum {result.params.prefixspan_min_support}.
        </SectionTitle>
        <label className="flex items-center gap-2 text-sm text-muted">
          Min length
          <select className="rounded-lg border border-line bg-card px-2 py-1" value={minLen} onChange={(e) => setMinLen(Number(e.target.value))}>
            {[2, 3, 4].map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <Table
        head={['Pattern', 'Support', 'Share of sessions', 'Participants']}
        rows={patterns.slice(0, 25).map((p) => (
          <tr key={p.pattern.join('>')}>
            <td className="px-1 py-2"><Chain names={p.names} /></td>
            <td className="px-1">{p.support}</td>
            <td className="px-1">
              <div className="flex items-center gap-2">
                <span className="h-2 rounded-full" style={{ width: `${(p.support / maxSupport) * 80}px`, background: SERIES.weekday }} />
                {(p.supportShare * 100).toFixed(0)}%
              </div>
            </td>
            <td className="px-1">{p.participants}</td>
          </tr>
        ))}
      />
      <h3 className="mt-6 text-sm font-semibold">Direct transitions (next stop)</h3>
      <Table
        head={['From', 'To', 'Times', 'Participants']}
        rows={result.transitions.slice(0, 12).map((t) => (
          <tr key={`${t.from}>${t.to}`}>
            <td className="px-1 py-1.5">{name(t.from)}</td>
            <td className="px-1">{name(t.to)}</td>
            <td className="px-1">{t.count}</td>
            <td className="px-1">{t.participants}</td>
          </tr>
        ))}
      />
    </Card>
  )
}

/** RQ1: origin-destination table for frequent paths. */
export function RoutesSection({ result }) {
  const name = regionName(result)
  return (
    <Card>
      <SectionTitle title="Frequent paths">
        {result.summary.trips} trips (movement between stays, ≥ {result.params.min_trip_length_m} m) were traced over a {result.params.grid_cell_m} m grid.
        The map's corridor layer shows how many distinct trips used each cell-to-cell step. Below: the most common region-to-region trips.
      </SectionTitle>
      <Table
        head={['From', 'To', 'Trips', 'Participants', 'Median time', 'Median length']}
        rows={result.originDestination.slice(0, 12).map((o) => (
          <tr key={`${o.origin}>${o.destination}`}>
            <td className="px-1 py-1.5">{name(o.origin)}</td>
            <td className="px-1">{name(o.destination)}</td>
            <td className="px-1">{o.trips}</td>
            <td className="px-1">{o.participants}</td>
            <td className="px-1">{o.medianDurationMin} min</td>
            <td className="px-1">{o.medianLengthM} m</td>
          </tr>
        ))}
      />
    </Card>
  )
}

/** RQ6: trajectory clusters. */
export function ClustersSection({ result, selected, onSelect }) {
  const name = regionName(result)
  return (
    <Card>
      <SectionTitle title="Trajectory clusters">
        Trips resampled to {result.params.cluster_resample_n} points and grouped with DBSCAN (two trips are neighbours if on average within{' '}
        {result.params.cluster_eps_m} m; direction matters). {result.summary.noiseTrips} of {result.summary.trips} trips are unusual (noise).
        A cluster is a group of similar routes, not a group of people. Select one to highlight its mean path on the map.
      </SectionTitle>
      {result.clusters.length === 0 ? (
        <p className="text-sm text-muted">No clusters at these parameters.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {result.clusters.map((c) => (
            <button
              key={c.clusterId}
              onClick={() => onSelect(c.clusterId)}
              className={`rounded-xl border p-4 text-left transition-colors ${selected === c.clusterId ? 'border-violet-400/50 bg-violet-400/10 shadow-[0_0_20px_rgba(167,139,250,0.15)]' : 'border-line hover:border-line-strong hover:bg-white/[0.03]'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">Cluster {c.clusterId}</span>
                {c.suppressed && <Pill>path hidden</Pill>}
              </div>
              <div className="tabular mt-2 text-sm text-muted">
                {c.trips} trips · {c.participants} participants
                <br />
                {c.medianLengthM} m · {c.medianDurationMin} min median · spread ±{c.spreadM} m
              </div>
              {c.commonOD && (
                <div className="mt-2 text-xs text-muted">
                  Mostly {name(c.commonOD.origin)} → {name(c.commonOD.destination)} ({Math.round(c.commonOD.share * 100)}%)
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}

/** Data quality + parameter sensitivity, for the methods slide. */
export function QualitySection({ result }) {
  const c = result.cleaning
  const ev = result.evaluation
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <SectionTitle title="Data quality">Every removed point has a recorded reason; accuracy is the device's own estimate.</SectionTitle>
        <dl className="tabular grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Observations kept</dt><dd>{c.keptObservations.toLocaleString()} / {c.totalObservations.toLocaleString()}</dd>
          {Object.entries(c.removedByReason).map(([k, v]) => (
            <Fragment key={k}><dt className="text-muted">Removed: {k.replaceAll('_', ' ')}</dt><dd>{v.toLocaleString()}</dd></Fragment>
          ))}
          <dt className="text-muted">Accuracy p50 / p90</dt><dd>{c.accuracyM.p50} / {c.accuracyM.p90} m</dd>
          <dt className="text-muted">Sampling interval p50</dt><dd>{c.samplingIntervalS.p50} s</dd>
          <dt className="text-muted">Trajectory length p50</dt><dd>{c.trajectoryDurationMin.p50} min</dd>
          <dt className="text-muted">Sessions per participant</dt>
          <dd>{ev.participantContribution.sessionsPerParticipant ? `${ev.participantContribution.sessionsPerParticipant.min}–${ev.participantContribution.sessionsPerParticipant.max} (median ${ev.participantContribution.sessionsPerParticipant.median})` : '—'}</dd>
        </dl>
      </Card>
      <Card>
        <SectionTitle title="Parameter sensitivity">How results move with thresholds. Without ground truth this is exploratory, not an accuracy score.</SectionTitle>
        <h3 className="text-sm font-semibold">Stay points</h3>
        <Table
          head={['Radius', 'Min stay', 'Stay points', 'Median dwell']}
          rows={ev.stayPointSensitivity.map((r) => (
            <tr key={`${r.distanceM}-${r.minDurationS}`} className={r.distanceM === result.params.stay_distance_m && r.minDurationS === result.params.stay_min_duration_s ? 'font-semibold' : ''}>
              <td className="px-1 py-1">{r.distanceM} m</td><td className="px-1">{r.minDurationS / 60} min</td><td className="px-1">{r.stayPoints}</td><td className="px-1">{r.medianDwellMin ?? '—'} min</td>
            </tr>
          ))}
        />
        <h3 className="mt-4 text-sm font-semibold">Clustering</h3>
        <Table
          head={['eps', 'min samples', 'Clusters', 'Noise', 'Largest']}
          rows={ev.clusteringSensitivity.map((r) => (
            <tr key={`${r.epsM}-${r.minSamples}`} className={r.epsM === result.params.cluster_eps_m && r.minSamples === result.params.cluster_min_samples ? 'font-semibold' : ''}>
              <td className="px-1 py-1">{r.epsM} m</td><td className="px-1">{r.minSamples}</td><td className="px-1">{r.clusters}</td><td className="px-1">{r.noiseShare != null ? `${Math.round(r.noiseShare * 100)}%` : '—'}</td><td className="px-1">{r.largestCluster}</td>
            </tr>
          ))}
        />
        <h3 className="mt-4 text-sm font-semibold">PrefixSpan minimum support</h3>
        <p className="tabular mt-1 text-sm text-muted">{ev.prefixspanSupportSweep.map((s) => `${s.minSupport} → ${s.patterns} patterns`).join(' · ')}</p>
      </Card>
    </div>
  )
}
