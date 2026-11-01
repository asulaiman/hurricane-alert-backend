import type { OfficialAlert } from './officialAlert'

// GDACS's list endpoint returns ~100 recent events regardless of query params
// (eventtype filters were tried and don't reliably narrow server-side), and
// crucially includes events long past their `todate` — `iscurrent` is the
// field that actually marks whether an event is still active, confirmed by
// inspecting live responses. Filtering on dates alone would resurface old storms.
const GDACS_EVENTS_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH'
const RELEVANT_EVENT_TYPES = new Set(['TC', 'FL'])

// GDACS gives a single centroid point per event, not the storm's full wind
// field or forecast cone — a generous radius approximates "is this nearby"
// without over-claiming precision.
const PROXIMITY_KM = 500

interface GdacsFeature {
  geometry: { type: string; coordinates: [number, number] } // [lon, lat]
  properties: {
    eventtype: string
    eventid: number
    eventname: string
    name: string
    htmldescription: string
    alertlevel: string
    iscurrent: string // "true" | "false" (string, not boolean)
    fromdate: string
    todate: string
    country: string
    url: { report: string }
    severitydata?: { severitytext?: string }
  }
}

interface GdacsResponse {
  features: GdacsFeature[]
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

export async function fetchGdacsAlerts(latitude: number, longitude: number): Promise<OfficialAlert[]> {
  const response = await fetch(GDACS_EVENTS_URL)
  if (!response.ok) {
    throw new Error(`GDACS events request failed (${response.status})`)
  }
  const data = (await response.json()) as GdacsResponse

  return data.features
    .filter((feature) => {
      const props = feature.properties
      if (props.iscurrent !== 'true') return false
      if (!RELEVANT_EVENT_TYPES.has(props.eventtype)) return false
      const [lon, lat] = feature.geometry.coordinates
      return haversineKm(latitude, longitude, lat, lon) <= PROXIMITY_KM
    })
    .map((feature) => {
      const props = feature.properties
      return {
        source: 'GDACS' as const,
        id: `${props.eventid}:${props.alertlevel}`,
        title: props.name,
        severity: props.alertlevel,
        headline: `${props.alertlevel} ${props.eventtype === 'TC' ? 'Tropical Cyclone' : 'Flood'} — ${props.country}`,
        description: props.severitydata?.severitytext ?? props.htmldescription.replace(/<[^>]+>/g, ''),
        effective: props.fromdate,
        expires: props.todate,
        url: props.url?.report ?? null,
      }
    })
}
