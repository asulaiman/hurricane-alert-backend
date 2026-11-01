import { withCors, type ApiHandler } from './_lib/http'
import { fetchForecast } from './_lib/openMeteo'
import { analyzeForecast } from './_lib/advisory'

const handler: ApiHandler = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const latitude = Number(req.query.lat)
  const longitude = Number(req.query.lon)
  if (!req.query.lat?.trim() || !req.query.lon?.trim() ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    res.status(400).json({ error: 'Valid lat and lon query params are required' })
    return
  }
  try {
    const forecast = await fetchForecast({ latitude, longitude })
    res.status(200).json({
      current: forecast.current,
      timezone: forecast.timezone,
      advisory: analyzeForecast(forecast),
    })
  } catch (error) {
    console.error('/api/forecast failed:', error)
    res.status(502).json({ error: 'Could not fetch forecast' })
  }
}

export default withCors(handler)
