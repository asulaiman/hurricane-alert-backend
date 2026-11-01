import type { ForecastResult } from './openMeteo'

export type AdvisoryLevel = 0 | 1 | 2 | 3

export interface AdvisoryPeak {
  value: number
  time: string
}

export interface Advisory {
  level: AdvisoryLevel
  label: string
  description: string
  color: string
  maxSustainedWind: AdvisoryPeak
  maxGust: AdvisoryPeak
  next24hPrecipitation: number
  flashFloodRisk: boolean
  pressureDropLast3h: number | null
}

// Thresholds are our own forecast-based heuristics, not official NHC/NWS
// criteria (Open-Meteo has no hurricane advisory feed to source them from).
const HURRICANE_WIND_MPH = 74
const HURRICANE_GUST_MPH = 100
const TROPICAL_STORM_WIND_MPH = 39
const TROPICAL_STORM_GUST_MPH = 58
const STRONG_WIND_MPH = 25
const STRONG_GUST_MPH = 39
const FLASH_FLOOD_24H_INCHES = 3
const SIGNIFICANT_PRESSURE_DROP_HPA = 3

const LEVELS: Record<AdvisoryLevel, { label: string; description: string; color: string }> = {
  0: {
    label: 'No Advisory',
    description: 'No storm conditions expected in the next 48 hours based on current forecast data.',
    color: '#2f9e44',
  },
  1: {
    label: 'Strong Wind / Heavy Rain Advisory',
    description: 'Elevated wind or rainfall is forecast. Secure loose outdoor items and monitor conditions.',
    color: '#e8a400',
  },
  2: {
    label: 'Tropical-Storm-Force Conditions Advisory',
    description: 'Sustained winds or gusts at tropical-storm strength (39+ mph) are forecast. Review your storm plan.',
    color: '#e8590c',
  },
  3: {
    label: 'Hurricane-Force Conditions Advisory',
    description: 'Sustained winds or gusts at hurricane strength (74+ mph) are forecast. Follow local emergency guidance.',
    color: '#c92a2a',
  },
}

function peakOver(values: number[], times: string[]): AdvisoryPeak {
  let best = { value: -Infinity, time: times[0] ?? '' }
  values.forEach((value, i) => {
    if (value > best.value) best = { value, time: times[i] }
  })
  return best
}

export function analyzeForecast(forecast: ForecastResult): Advisory {
  const { hourly } = forecast
  // hourly arrays include 3 past hours (past_hours=3) before the forecast
  // horizon, so "now" is wherever current.time lands in that array, not index 0.
  const nowIndex = Math.max(hourly.time.indexOf(forecast.current.time), 0)
  const upcomingTime = hourly.time.slice(nowIndex)
  const upcomingWind = hourly.windSpeed.slice(nowIndex)
  const upcomingGusts = hourly.windGusts.slice(nowIndex)
  const upcomingPrecipitation = hourly.precipitation.slice(nowIndex)

  const maxSustainedWind = peakOver(upcomingWind, upcomingTime)
  const maxGust = peakOver(upcomingGusts, upcomingTime)

  const next24hPrecipitation = upcomingPrecipitation
    .slice(0, 24)
    .reduce((sum, value) => sum + value, 0)
  const flashFloodRisk = next24hPrecipitation >= FLASH_FLOOD_24H_INCHES

  const pressureNow = forecast.current.surfacePressure
  const pressure3hAgo = hourly.surfacePressure[Math.max(nowIndex - 3, 0)]
  const pressureDropLast3h =
    typeof pressureNow === 'number' && typeof pressure3hAgo === 'number'
      ? pressure3hAgo - pressureNow
      : null

  let level: AdvisoryLevel = 0
  if (maxSustainedWind.value >= HURRICANE_WIND_MPH || maxGust.value >= HURRICANE_GUST_MPH) {
    level = 3
  } else if (
    maxSustainedWind.value >= TROPICAL_STORM_WIND_MPH ||
    maxGust.value >= TROPICAL_STORM_GUST_MPH
  ) {
    level = 2
  } else if (
    maxSustainedWind.value >= STRONG_WIND_MPH ||
    maxGust.value >= STRONG_GUST_MPH ||
    flashFloodRisk
  ) {
    level = 1
  }

  const base = LEVELS[level]
  const notes: string[] = [base.description]
  if (flashFloodRisk) {
    notes.push(`Heavy rainfall risk: ${next24hPrecipitation.toFixed(1)} in forecast over the next 24 hours.`)
  }
  if (pressureDropLast3h !== null && pressureDropLast3h >= SIGNIFICANT_PRESSURE_DROP_HPA) {
    notes.push(`Pressure has dropped ${pressureDropLast3h.toFixed(1)} hPa in the last 3 hours, indicating a strengthening system.`)
  }

  return {
    level,
    label: base.label,
    description: notes.join(' '),
    color: base.color,
    maxSustainedWind,
    maxGust,
    next24hPrecipitation,
    flashFloodRisk,
    pressureDropLast3h,
  }
}
