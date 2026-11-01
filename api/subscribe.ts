import { withCors, type ApiHandler } from './_lib/http'
import { query } from './_lib/db'
import { generateToken } from './_lib/tokens'
import { sendVerificationEmail } from './_lib/mail'
import { isVerificationRateLimited } from './_lib/rateLimit'

const VERIFICATION_TTL_HOURS = 24

interface SubscribeBody {
  latitude: number
  longitude: number
  label?: string
  email?: string
  wantsPush?: boolean
  consentText: string
}

function isValidBody(body: unknown): body is SubscribeBody {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    typeof b.latitude === 'number' &&
    typeof b.longitude === 'number' &&
    typeof b.consentText === 'string' &&
    b.consentText.length > 0 &&
    (b.email === undefined || typeof b.email === 'string') &&
    (b.wantsPush === undefined || typeof b.wantsPush === 'boolean') &&
    Boolean(b.email || b.wantsPush)
  )
}

const handler: ApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!isValidBody(req.body)) {
    res.status(400).json({ error: 'latitude, longitude, consentText, and at least one of email/wantsPush are required' })
    return
  }

  const { latitude, longitude, label, email, wantsPush, consentText } = req.body

  try {
    let subscriberId: number
    if (email) {
      const upserted = await query<{ id: number }>(
        `insert into subscribers (email) values ($1)
         on conflict (email) do update set email = excluded.email
         returning id`,
        [email],
      )
      subscriberId = upserted.rows[0].id
    } else {
      const created = await query<{ id: number }>(`insert into subscribers default values returning id`)
      subscriberId = created.rows[0].id
    }

    const subscription = await query<{ id: number }>(
      `insert into subscriptions (subscriber_id, latitude, longitude, label, channels, consent_text, consent_at)
       values ($1, $2, $3, $4, $5, $6, now())
       returning id`,
      [
        subscriberId,
        latitude,
        longitude,
        label ?? null,
        JSON.stringify({ email: Boolean(email), push: false, sms: false }),
        consentText,
      ],
    )
    const subscriptionId = subscription.rows[0].id

    let requiresEmailVerification = false
    if (email) {
      if (await isVerificationRateLimited(subscriberId)) {
        res.status(429).json({ error: 'Too many verification emails sent recently. Try again later.' })
        return
      }
      const token = generateToken()
      await query(
        `insert into verification_tokens (subscriber_id, kind, token, expires_at)
         values ($1, 'email_verify', $2, now() + interval '${VERIFICATION_TTL_HOURS} hours')`,
        [subscriberId, token],
      )
      const baseUrl = process.env.API_BASE_URL || `http://${req.headers.host}`
      await sendVerificationEmail(email, `${baseUrl}/api/verify-email?token=${token}`)
      requiresEmailVerification = true
    }

    res.status(201).json({ subscriptionId, requiresEmailVerification, wantsPush: Boolean(wantsPush) })
  } catch (err) {
    console.error('/api/subscribe failed:', err)
    res.status(500).json({ error: 'Could not create subscription' })
  }
}

export default withCors(handler)
