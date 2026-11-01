import { withCors, type ApiHandler } from '../_lib/http'
import { query } from '../_lib/db'
import { getOfficialAlerts } from '../_lib/officialAlerts'
import { fetchForecast } from '../_lib/openMeteo'
import { analyzeForecast, type Advisory } from '../_lib/advisory'
import type { OfficialAlert } from '../_lib/officialAlert'
import { sendPushNotification } from '../_lib/push'
import { sendAdvisoryEmail } from '../_lib/mail'
import { createUnsubscribeToken } from '../_lib/tokens'

interface NotifiedAlertRecord {
  id: string
  expires: string | null
}

interface SubscriptionRow {
  id: number
  subscriber_id: number
  latitude: number
  longitude: number
  label: string | null
  channels: { push: boolean; email: boolean; sms: boolean }
  push_subscription_json: { endpoint: string; keys: { p256dh: string; auth: string } } | null
  last_computed_level: number
  last_notified_level: number
  notified_official_alerts: NotifiedAlertRecord[]
  email: string | null
  email_verified: boolean
}

// ~11m precision (4 decimal places) — precise enough to avoid the zone-boundary
// mistake a coarser rounding would cause for NWS's point-based alerts, while
// still deduping subscribers who picked the identical geocoded location.
function locationKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`
}

function pruneExpired(records: NotifiedAlertRecord[]): NotifiedAlertRecord[] {
  const now = Date.now()
  return records.filter((record) => !record.expires || new Date(record.expires).getTime() > now)
}

function buildNotificationContent(
  advisory: Advisory,
  heuristicRose: boolean,
  newAlerts: OfficialAlert[],
): { title: string; body: string } {
  const parts: string[] = []
  if (heuristicRose) {
    parts.push(`Advisory level raised to "${advisory.label}": ${advisory.description}`)
  }
  for (const alert of newAlerts) {
    parts.push(`${alert.source} ${alert.severity} — ${alert.title}: ${alert.headline}`)
  }
  const title = heuristicRose ? `Storm Advisory: ${advisory.label}` : `New Alert: ${newAlerts[0].title}`
  return { title, body: parts.join('\n\n') }
}

async function loadActiveSubscriptions(): Promise<SubscriptionRow[]> {
  const result = await query<SubscriptionRow>(
    `select s.id, s.subscriber_id, s.latitude, s.longitude, s.label, s.channels,
            s.push_subscription_json, s.last_computed_level, s.last_notified_level,
            s.notified_official_alerts, sub.email, sub.email_verified
     from subscriptions s
     join subscribers sub on sub.id = s.subscriber_id
     where s.active = true`,
  )
  return result.rows
}

const handler: ApiHandler = async (req, res) => {
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.authorization
  if (!secret || authHeader !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const subscriptions = await loadActiveSubscriptions()
    const groups = new Map<string, SubscriptionRow[]>()
    for (const sub of subscriptions) {
      const key = locationKey(sub.latitude, sub.longitude)
      const group = groups.get(key)
      if (group) group.push(sub)
      else groups.set(key, [sub])
    }

    let notifiedCount = 0

    for (const [, group] of groups) {
      const { latitude, longitude } = group[0]
      const [forecast, officialAlerts] = await Promise.all([
        fetchForecast({ latitude, longitude }),
        getOfficialAlerts(latitude, longitude),
      ])
      const advisory = analyzeForecast(forecast)

      for (const sub of group) {
        const heuristicRose = advisory.level > sub.last_computed_level
        const prunedNotifiedAlerts = pruneExpired(sub.notified_official_alerts)
        const alreadyNotified = new Set(prunedNotifiedAlerts.map((r) => r.id))
        const newAlerts = officialAlerts.filter((a) => !alreadyNotified.has(a.id))
        const updatedNotifiedAlerts = [
          ...prunedNotifiedAlerts,
          ...newAlerts.map((a) => ({ id: a.id, expires: a.expires })),
        ]

        if (heuristicRose || newAlerts.length > 0) {
          const content = buildNotificationContent(advisory, heuristicRose, newAlerts)

          if (sub.channels.push && sub.push_subscription_json) {
            await sendPushNotification(sub.push_subscription_json, {
              title: content.title,
              body: content.body,
              url: process.env.APP_BASE_URL,
            }).catch((err) => console.error(`push send failed for subscription ${sub.id}:`, err))
          }

          if (sub.channels.email && sub.email_verified && sub.email) {
            const unsubToken = await createUnsubscribeToken(sub.subscriber_id, sub.id)
            const baseUrl = process.env.API_BASE_URL || `http://${req.headers.host}`
            await sendAdvisoryEmail(
              sub.email,
              content.title,
              `<p>${content.body.replace(/\n\n/g, '</p><p>')}</p>`,
              `${baseUrl}/api/unsubscribe?token=${unsubToken}`,
            ).catch((err) => console.error(`advisory email failed for subscription ${sub.id}:`, err))
          }

          notifiedCount += 1
        }

        await query(
          `update subscriptions
           set last_computed_level = $1,
               last_notified_level = case when $2 then $1 else last_notified_level end,
               notified_official_alerts = $3
           where id = $4`,
          [advisory.level, heuristicRose, JSON.stringify(updatedNotifiedAlerts), sub.id],
        )
      }
    }

    res.status(200).json({ checked: subscriptions.length, locations: groups.size, notified: notifiedCount })
  } catch (err) {
    console.error('/api/cron/check-subscriptions failed:', err)
    res.status(500).json({ error: 'Cron run failed' })
  }
}

export default withCors(handler)
