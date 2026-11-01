export interface OfficialAlert {
  source: 'NWS' | 'GDACS'
  id: string
  title: string
  severity: string
  headline: string
  description: string
  effective: string | null
  expires: string | null
  url: string | null
}
