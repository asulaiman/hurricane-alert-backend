import { withCors, type ApiHandler } from './_lib/http'
import { getOfficialAlerts } from './_lib/officialAlerts'

const handler: ApiHandler = async (req, res) => {
  const latitude = Number(req.query.lat)
  const longitude = Number(req.query.lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    res.status(400).json({ error: 'lat and lon query params are required' })
    return
  }

  try {
    const alerts = await getOfficialAlerts(latitude, longitude)
    res.status(200).json({ alerts })
  } catch (err) {
    console.error('/api/alerts failed:', err)
    res.status(502).json({ error: 'Could not fetch official alerts' })
  }
}

export default withCors(handler)
