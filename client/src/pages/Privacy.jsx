import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Card, PageHeader } from '../components/ui'

export default function Privacy() {
  const [cfg, setCfg] = useState(null)
  useEffect(() => {
    api.collectionConfig().then((r) => setCfg(r.data)).catch(() => {})
  }, [])

  const items = [
    ['What we collect', 'During an active session only: timestamp, latitude, longitude, and (if your device reports them) accuracy, speed and heading. Plus session start/stop/pause times, the sampling interval you chose, and whether you used a phone or a computer. No device identifiers, contacts or browsing data.'],
    ['When we collect', 'Only between pressing Start and pressing Stop (or Pause), and only while the CampusFlow page is open. Ordinary web pages cannot track you in the background, and CampusFlow does not try to.'],
    ['Identity separation', 'Your email lives in an account record. Your location data is linked to a random participant identifier instead. Analysts and dashboards only see the participant identifier, never your email.'],
    ['Who can see raw traces', 'You can view your own traces on the "My data" page. Researchers see only aggregate dataset summaries in the app. Raw traces are processed for analysis only by authorised study researchers, and every such export is logged. Raw individual trajectories are never published.'],
    ['What gets published', `Only aggregate results (for example: how many distinct participants passed through an area in an hour). Results based on fewer than ${cfg ? cfg.minAggregateParticipants : 'a minimum number of'} distinct participants are suppressed. Hashing or removing names does not make location traces anonymous, so we do not publish them in any form.`],
    ['Data on your device', 'If you lose connection, unsent points are kept temporarily in your browser’s storage and deleted once uploaded. Signing out deletes any unsent points from the device.'],
    ['Map tiles', 'When you view a map, its images are loaded from CARTO’s tile servers (OpenStreetMap data), which see the approximate area being displayed, as with any web map.'],
    ['Retention', cfg ? (cfg.retentionDays > 0 ? `Raw traces are deleted automatically ${cfg.retentionDays} days after collection.` : 'Automatic deletion is currently disabled; raw traces are kept until you or the study team delete them.') : 'Raw traces are deleted automatically after the study retention period.'],
    ['Your choices', 'You can delete a single session, delete all your data, withdraw consent (optionally deleting everything), or delete your account. Withdrawal has no consequences of any kind.'],
  ]

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Privacy notice" title="How CampusFlow handles location data">
        Campus mobility data can reveal sensitive routines even without names. These rules are built into the system, not just promised.
      </PageHeader>
      <Card>
        <dl className="divide-y divide-line">
          {items.map(([k, v]) => (
            <div key={k} className="grid gap-1 py-4 first:pt-0 last:pb-0 sm:grid-cols-[12rem_1fr] sm:gap-6">
              <dt className="font-semibold text-ink">{k}</dt>
              <dd className="text-[15px] leading-relaxed text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  )
}
