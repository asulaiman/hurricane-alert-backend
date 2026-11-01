const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'

interface Coordinates {
  latitude: number
  longitude: number
}

export interface HourlyForecast {
  time: string[]
  windSpeed: number[]
  windGusts: number[]
  precipitation: number[]
  surfacePressure: number[]
}

export interface CurrentConditions {
  time: string
  windSpeed: number
  windGusts: number
  precipitation: number
  surfacePressure: number
}

export interface ForecastResult {
  current: CurrentConditions
  hourly: HourlyForecast
  timezone: string
}

export async function fetchForecast({ latitude, longitude }: Coordinates): Promise<ForecastResult> {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: 'wind_speed_10m,wind_gusts_10m,precipitation,surface_pressure',
    hourly: 'wind_speed_10m,wind_gusts_10m,precipitation,surface_pressure',
    forecast_hours: '48',
    past_hours: '3',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
  })

  const response = await fetch(`${FORECAST_URL}?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Open-Meteo forecast request failed (${response.status})`)
  }
  const data = await response.json()

  return {
    timezone: data.timezone,
    current: {
      time: data.current.time,
      windSpeed: data.current.wind_speed_10m,
      windGusts: data.current.wind_gusts_10m,
      precipitation: data.current.precipitation,
      surfacePressure: data.current.surface_pressure,
    },
    hourly: {
      time: data.hourly.time,
      windSpeed: data.hourly.wind_speed_10m,
      windGusts: data.hourly.wind_gusts_10m,
      precipitation: data.hourly.precipitation,
      surfacePressure: data.hourly.surface_pressure,
    },
  }
}

export interface GeocodingResult {
  id: number
  name: string
  admin1?: string
  country?: string
  latitude: number
  longitude: number
}

export async function searchLocations(query: string): Promise<GeocodingResult[]> {
  const params = new URLSearchParams({ name: query, count: '5', language: 'en', format: 'json' })
  const response = await fetch(`${GEOCODING_URL}?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Open-Meteo geocoding request failed (${response.status})`)
  }
  const data = await response.json()
  return data.results ?? []
}
