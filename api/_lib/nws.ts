import type { OfficialAlert } from './officialAlert'

// api.weather.gov requires a descriptive User-Agent identifying the caller
// for rate-limiting/contact purposes. Browsers refuse to let fetch() set this
// header, so this call can only happen server-side.
const NWS_CONTACT = process.env.NWS_CONTACT || 'hurricane-alert (no contact configured)'

interface NwsAlertsResponse {
  features: Array<{
    id: string
    properties: {
      event: string
      severity: string
      headline: string
      description: string
      effective: string | null
      expires: string | null
      '@id': string
    }
  }>
}

export async function fetchNwsAlerts(latitude: number, longitude: number): Promise<OfficialAlert[]> {
  const url = `https://api.weather.gov/alerts/active?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`
  const response = await fetch(url, {
    headers: {
      'User-Agent': NWS_CONTACT,
      Accept: 'application/geo+json',
    },
  })

  if (response.status === 404) return [] // NWS returns 404 for points outside its coverage area
  if (!response.ok) {
    throw new Error(`NWS alerts request failed (${response.status})`)
  }

  const data = (await response.json()) as NwsAlertsResponse
  return data.features.map((feature) => ({
    source: 'NWS' as const,
    id: feature.id,
    title: feature.properties.event,
    severity: feature.properties.severity,
    headline: feature.properties.headline,
    description: feature.properties.description,
    effective: feature.properties.effective,
    expires: feature.properties.expires,
    url: feature.properties['@id'],
  }))
}
