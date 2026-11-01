import { randomBytes } from 'node:crypto'
import { query } from './db'

export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

const UNSUBSCRIBE_TTL_DAYS = 365

// One-click unsubscribe links are meant to work indefinitely for as long as
// a subscription stays active, hence the long TTL rather than a short-lived token.
export async function createUnsubscribeToken(subscriberId: number, subscriptionId: number): Promise<string> {
  const token = generateToken()
  await query(
    `insert into verification_tokens (subscriber_id, subscription_id, kind, token, expires_at)
     values ($1, $2, 'unsubscribe', $3, now() + interval '${UNSUBSCRIBE_TTL_DAYS} days')`,
    [subscriberId, subscriptionId, token],
  )
  return token
}
