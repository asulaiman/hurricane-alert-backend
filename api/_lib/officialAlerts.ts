import type { OfficialAlert } from './officialAlert'
import { fetchNwsAlerts } from './nws'
import { fetchGdacsAlerts } from './gdacs'

const SEVERITY_RANK: Record<string, number> = {
  extreme: 4,
  red: 4,
  severe: 3,
  orange: 2,
  moderate: 2,
  minor: 1,
  green: 1,
}

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity.toLowerCase()] ?? 0
}

// Shared by the /api/alerts route (what a visitor sees) and the cron worker
// (what decides whether to notify) so the two can never disagree about what's
// currently active for a location.
export async function getOfficialAlerts(latitude: number, longitude: number): Promise<OfficialAlert[]> {
  const [nws, gdacs] = await Promise.all([
    fetchNwsAlerts(latitude, longitude).catch(() => [] as OfficialAlert[]),
    fetchGdacsAlerts(latitude, longitude).catch(() => [] as OfficialAlert[]),
  ])

  return [...nws, ...gdacs].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
}
