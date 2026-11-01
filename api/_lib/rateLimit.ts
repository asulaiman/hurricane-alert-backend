import { query } from './db'

const MAX_VERIFICATIONS_PER_HOUR = 3

// Without this, /api/subscribe becomes a way to spam a stranger's inbox
// (repeatedly "sign up" their email) using our own Resend quota.
export async function isVerificationRateLimited(subscriberId: number): Promise<boolean> {
  const result = await query<{ count: string }>(
    `select count(*) from verification_tokens
     where subscriber_id = $1 and kind = 'email_verify' and created_at > now() - interval '1 hour'`,
    [subscriberId],
  )
  return Number(result.rows[0].count) >= MAX_VERIFICATIONS_PER_HOUR
}
