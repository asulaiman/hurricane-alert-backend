import { withCors, type ApiHandler } from '../_lib/http'
import { query } from '../_lib/db'

interface PushSubscribeBody {
  subscriptionId: number
  pushSubscription: { endpoint: string; keys: { p256dh: string; auth: string } }
}

function isValidBody(body: unknown): body is PushSubscribeBody {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  const sub = b.pushSubscription as Record<string, unknown> | undefined
  return (
    typeof b.subscriptionId === 'number' &&
    !!sub &&
    typeof sub.endpoint === 'string' &&
    !!sub.keys
  )
}

const handler: ApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!isValidBody(req.body)) {
    res.status(400).json({ error: 'subscriptionId and pushSubscription are required' })
    return
  }

  const { subscriptionId, pushSubscription } = req.body

  try {
    const result = await query(
      `update subscriptions
       set push_subscription_json = $1,
           channels = jsonb_set(channels, '{push}', 'true')
       where id = $2 and active = true`,
      [JSON.stringify(pushSubscription), subscriptionId],
    )
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Subscription not found or inactive' })
      return
    }
    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('/api/push/subscribe failed:', err)
    res.status(500).json({ error: 'Could not save push subscription' })
  }
}

export default withCors(handler)
